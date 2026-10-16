/**
 * DukaanDost - Billing Tests
 * Tests preview/confirm flow, stock deduction, GST calculations,
 * constraint validations, and atomic transaction rollback using an in-memory DB.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { initDb, getTodayDate, getCustomerBalance, resetTurn, incrementTurn } = require('../src/db');
const { createBill, clearPendingBills } = require('../src/tools/billing');

describe('Billing Tool (create_bill)', () => {
  let db;
  const today = getTodayDate().dateString;

  beforeEach(() => {
    clearPendingBills();
    resetTurn();
    // Fresh in-memory DB for every test
    db = initDb(':memory:');

    // Seed test products
    db.prepare(`
      INSERT INTO products (product_id, name, category, unit_price, stock_qty, gst_percent, expiry_date, unit)
      VALUES 
        (1, 'Test Atta 5kg', 'Staples', 200.00, 20, 0, '2027-12-31', 'pack'),
        (2, 'Test Butter 100g', 'Dairy', 50.00, 10, 12, '2027-12-31', 'pack'),
        (3, 'Test Expired Dahi', 'Dairy', 30.00, 15, 5, '2020-01-01', 'cup'),
        (4, 'Test Low Stock Rice', 'Staples', 100.00, 3, 5, '2027-12-31', 'kg')
    `).run();

    // Seed test customers
    db.prepare(`
      INSERT INTO customers (customer_id, name, phone, credit_limit)
      VALUES 
        (1, 'Sharma Ji', '9876543210', 2000.00),
        (2, 'Sunita Devi', '9876543211', 1000.00)
    `).run();
  });

  test('Preview does not write to database or deduct stock', () => {
    const res = createBill({
      customer_name: 'Sharma Ji',
      items: [{ product_id: 1, quantity: 2 }],
      payment_mode: 'CASH',
      confirm: false
    }, db);

    assert.strictEqual(res.ok, true);
    assert.ok(res.preview);
    assert.strictEqual(res.preview.status, 'PENDING_CONFIRMATION');
    assert.strictEqual(res.preview.subtotal, 400.00);

    // Verify DB remains untouched
    const billCount = db.prepare('SELECT COUNT(*) AS c FROM bills').get().c;
    assert.strictEqual(billCount, 0, 'Bills table should have 0 records after preview');

    const stock = db.prepare('SELECT stock_qty FROM products WHERE product_id = 1').get().stock_qty;
    assert.strictEqual(stock, 20, 'Stock must not be deducted on preview');
  });

  test('Confirm without preview is rejected', () => {
    clearPendingBills();

    const res = createBill({
      customer_name: 'Sharma Ji',
      items: [{ product_id: 1, quantity: 2 }],
      payment_mode: 'CASH',
      confirm: true
    }, db);

    assert.strictEqual(res.ok, false);
    assert.match(res.error, /preview/i);

    const billCount = db.prepare('SELECT COUNT(*) AS c FROM bills').get().c;
    assert.strictEqual(billCount, 0);
  });

  test('Stock is deducted correctly after confirmation', () => {
    // Step 1: Preview
    const pRes = createBill({
      customer_name: 'Sharma Ji',
      items: [{ product_id: 1, quantity: 3 }],
      payment_mode: 'CASH',
      confirm: false
    }, db);
    assert.strictEqual(pRes.ok, true);

    // Step 2: Confirm in next turn
    incrementTurn();
    const cRes = createBill({
      customer_name: 'Sharma Ji',
      items: [{ product_id: 1, quantity: 3 }],
      payment_mode: 'CASH',
      confirm: true
    }, db);

    assert.strictEqual(cRes.ok, true);
    assert.ok(cRes.bill_id);

    // Verify stock deduction: 20 - 3 = 17
    const stock = db.prepare('SELECT stock_qty FROM products WHERE product_id = 1').get().stock_qty;
    assert.strictEqual(stock, 17);

    // Verify bill row
    const bill = db.prepare('SELECT * FROM bills WHERE bill_id = ?').get(cRes.bill_id);
    assert.strictEqual(bill.subtotal, 600.00);
    assert.strictEqual(bill.total, 600.00);
    assert.strictEqual(bill.payment_mode, 'CASH');
  });

  test('GST and subtotal math are accurately calculated', () => {
    // Product 2: price 50.00, GST 12%, qty: 4
    // Subtotal = 200.00, GST = 24.00, Total = 224.00
    const res = createBill({
      items: [{ product_id: 2, quantity: 4 }],
      payment_mode: 'UPI',
      confirm: false
    }, db);

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.preview.subtotal, 200.00);
    assert.strictEqual(res.preview.total_gst, 24.00);
    assert.strictEqual(res.preview.grand_total, 224.00);
  });

  test('Insufficient stock is rejected with available quantity details', () => {
    // Product 4 has stock 3; requesting 5
    const res = createBill({
      items: [{ product_id: 4, quantity: 5 }],
      payment_mode: 'CASH',
      confirm: false
    }, db);

    assert.strictEqual(res.ok, false);
    assert.match(res.error, /Insufficient stock/i);
    assert.match(res.error, /Available: 3/);
  });

  test('Expired product cannot be billed', () => {
    // Product 3 expired in 2020
    const res = createBill({
      items: [{ product_id: 3, quantity: 1 }],
      payment_mode: 'CASH',
      confirm: false
    }, db);

    assert.strictEqual(res.ok, false);
    assert.match(res.error, /expired/i);
  });

  test('CREDIT bill exceeding customer limit is refused', () => {
    // Sunita Devi limit: 1000. Existing debit: 900. Headroom: 100.
    db.prepare(`
      INSERT INTO credit_ledger (customer_id, amount, type, entry_date, note)
      VALUES (2, 900.00, 'DEBIT', ?, 'Prior balance')
    `).run(today);

    // Bill total for 1 Atta = 200.00 > available 100
    const res = createBill({
      customer_name: 'Sunita Devi',
      items: [{ product_id: 1, quantity: 1 }],
      payment_mode: 'CREDIT',
      confirm: false
    }, db);

    assert.strictEqual(res.ok, false);
    assert.match(res.error, /Credit limit exceeded/i);
    assert.strictEqual(res.headroom, 100.00);
    assert.strictEqual(res.bill_total, 200.00);
  });

  test('CREDIT bill within limit creates DEBIT entry and links bill', () => {
    // Sharma Ji has 0 balance, limit 2000. Bill: 1 Butter (50 + 12% = 56.00)
    const pRes = createBill({
      customer_name: 'Sharma Ji',
      items: [{ product_id: 2, quantity: 1 }],
      payment_mode: 'CREDIT',
      confirm: false
    }, db);
    assert.strictEqual(pRes.ok, true);

    incrementTurn();
    const cRes = createBill({
      customer_name: 'Sharma Ji',
      items: [{ product_id: 2, quantity: 1 }],
      payment_mode: 'CREDIT',
      confirm: true
    }, db);
    assert.strictEqual(cRes.ok, true);

    // Verify balance
    const balance = getCustomerBalance(db, 1);
    assert.strictEqual(balance, 56.00);

    // Verify credit ledger
    const ledger = db.prepare('SELECT * FROM credit_ledger WHERE customer_id = 1 AND bill_id = ?').get(cRes.bill_id);
    assert.ok(ledger);
    assert.strictEqual(ledger.type, 'DEBIT');
    assert.strictEqual(ledger.amount, 56.00);
  });

  test('Transaction rollback leaves stock unchanged on DB failure', () => {
    // Preview a valid bill
    const pRes = createBill({
      customer_name: 'Sharma Ji',
      items: [{ product_id: 1, quantity: 2 }],
      payment_mode: 'CASH',
      confirm: false
    }, db);
    assert.strictEqual(pRes.ok, true);

    const initialStock = db.prepare('SELECT stock_qty FROM products WHERE product_id = 1').get().stock_qty;

    // Drop bill_items table to force transaction failure on confirmation
    db.exec('DROP TABLE bill_items;');

    incrementTurn();
    const cRes = createBill({
      customer_name: 'Sharma Ji',
      items: [{ product_id: 1, quantity: 2 }],
      payment_mode: 'CASH',
      confirm: true
    }, db);

    assert.strictEqual(cRes.ok, false);
    assert.match(cRes.error, /Billing failed/i);

    // Ensure stock was NOT deducted due to rollback
    const postStock = db.prepare('SELECT stock_qty FROM products WHERE product_id = 1').get().stock_qty;
    assert.strictEqual(postStock, initialStock);
  });

  test('Duplicate lines exceeding stock are rejected at preview, and duplicate lines within stock are merged', () => {
    // 1. Exceeding stock: Product 4 has stock 3; requesting 2 + 2 = 4
    const exceedRes = createBill({
      items: [
        { product_id: 4, quantity: 2 },
        { product_id: 4, quantity: 2 }
      ],
      payment_mode: 'CASH',
      confirm: false
    }, db);

    assert.strictEqual(exceedRes.ok, false);
    assert.match(exceedRes.error, /Insufficient stock/i);
    assert.match(exceedRes.error, /Available: 3/);

    const billsCount = db.prepare('SELECT COUNT(*) AS c FROM bills').get().c;
    assert.strictEqual(billsCount, 0);
    const unchangedStock = db.prepare('SELECT stock_qty FROM products WHERE product_id = 4').get().stock_qty;
    assert.strictEqual(unchangedStock, 3);

    // 2. Within stock: Product 2 (stock 10, unit_price 50, GST 12%); requesting 2 + 3 = 5
    // Preview
    const pRes = createBill({
      items: [
        { product_id: 2, quantity: 2 },
        { product_id: 2, quantity: 3 }
      ],
      payment_mode: 'CASH',
      confirm: false
    }, db);

    assert.strictEqual(pRes.ok, true);
    assert.strictEqual(pRes.preview.items.length, 1);
    assert.strictEqual(pRes.preview.items[0].product_id, 2);
    assert.strictEqual(pRes.preview.items[0].quantity, 5);
    assert.strictEqual(pRes.preview.subtotal, 250.00);
    assert.strictEqual(pRes.preview.total_gst, 30.00);
    assert.strictEqual(pRes.preview.grand_total, 280.00);

    // Confirm
    incrementTurn();
    const cRes = createBill({
      items: [
        { product_id: 2, quantity: 2 },
        { product_id: 2, quantity: 3 }
      ],
      payment_mode: 'CASH',
      confirm: true
    }, db);

    assert.strictEqual(cRes.ok, true);
    assert.strictEqual(cRes.items.length, 1);
    assert.strictEqual(cRes.items[0].quantity, 5);

    const billItems = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(cRes.bill_id);
    assert.strictEqual(billItems.length, 1);
    assert.strictEqual(billItems[0].product_id, 2);
    assert.strictEqual(billItems[0].quantity, 5);
    assert.strictEqual(billItems[0].price, 50.00);

    const postStock = db.prepare('SELECT stock_qty FROM products WHERE product_id = 2').get().stock_qty;
    assert.strictEqual(postStock, 5);
  });

  test('Confirm in the same turn is rejected; confirm in a later turn succeeds', () => {
    resetTurn();
    const pRes = createBill({
      customer_name: 'Sharma Ji',
      items: [{ product_id: 1, quantity: 1 }],
      payment_mode: 'CASH',
      confirm: false
    }, db);
    assert.strictEqual(pRes.ok, true);

    // Attempting confirm in the same turn without cashier input is rejected
    const sameTurnRes = createBill({
      customer_name: 'Sharma Ji',
      items: [{ product_id: 1, quantity: 1 }],
      payment_mode: 'CASH',
      confirm: true
    }, db);
    assert.strictEqual(sameTurnRes.ok, false);
    assert.match(sameTurnRes.error, /Please show this preview to the cashier and wait for their confirmation first/i);

    // Advancing turn (simulating cashier saying "yes") allows confirmation to succeed
    incrementTurn();
    const laterTurnRes = createBill({
      customer_name: 'Sharma Ji',
      items: [{ product_id: 1, quantity: 1 }],
      payment_mode: 'CASH',
      confirm: true
    }, db);
    assert.strictEqual(laterTurnRes.ok, true);
    assert.ok(laterTurnRes.bill_id);
  });
});

