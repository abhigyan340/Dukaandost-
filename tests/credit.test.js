/**
 * DukaanDost - Credit Tests
 * Tests balance computation, payment recording with 2-step confirmation,
 * overpayment guards, and fuzzy name resolution using an in-memory DB.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { initDb, getTodayDate, getCustomerBalance, resetTurn, incrementTurn } = require('../src/db');
const { getCustomerBalance: getCustomerBalanceTool, recordCreditPayment, clearPendingPayments } = require('../src/tools/credit');

describe('Credit Ledger Tools', () => {
  let db;
  const today = getTodayDate().dateString;

  beforeEach(() => {
    clearPendingPayments();
    resetTurn();
    db = initDb(':memory:');

    // Seed test customers
    db.prepare(`
      INSERT INTO customers (customer_id, name, phone, credit_limit)
      VALUES 
        (1, 'Sharma Ji', '9876543210', 2000.00),
        (2, 'Sunita Devi', '9876543211', 1000.00),
        (3, 'Rajesh Kumar', '9876543212', 1500.00)
    `).run();

    // Seed credit ledger:
    // Sharma Ji: DEBIT 800 + DEBIT 400 - PAYMENT 200 = 1000.00
    db.prepare(`
      INSERT INTO credit_ledger (customer_id, amount, type, entry_date, note)
      VALUES 
        (1, 800.00, 'DEBIT', ?, 'Bill #101'),
        (1, 400.00, 'DEBIT', ?, 'Bill #102'),
        (1, 200.00, 'PAYMENT', ?, 'Cash payment')
    `).run(today, today, today);
  });

  test('Outstanding balance accurately equals SUM(DEBIT) - SUM(PAYMENT)', () => {
    const rawBalance = getCustomerBalance(db, 1);
    assert.strictEqual(rawBalance, 1000.00);

    const res = getCustomerBalanceTool({ customer_id: 1 }, db);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.outstanding_balance, 1000.00);
    assert.strictEqual(res.credit_limit, 2000.00);
    assert.strictEqual(res.available_headroom, 1000.00);
    assert.strictEqual(res.recent_transactions.length, 3);
  });

  test('Fuzzy customer name resolution handles variations ("Sharma ji", "sharma ji", "Sharma")', () => {
    // Exact lowercase
    const r1 = getCustomerBalanceTool({ customer_name: 'sharma ji' }, db);
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r1.customer_id, 1);

    // Stripped honorific
    const r2 = getCustomerBalanceTool({ customer_name: 'Sharma' }, db);
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.customer_id, 1);

    // Capitalized with space
    const r3 = getCustomerBalanceTool({ customer_name: 'Sharma Ji' }, db);
    assert.strictEqual(r3.ok, true);
    assert.strictEqual(r3.customer_id, 1);
  });

  test('Unknown customer is handled gracefully with clear error', () => {
    const res = getCustomerBalanceTool({ customer_name: 'Unknown Person' }, db);
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /not found/i);
  });

  test('Payment reduces balance after 2-step confirmation', () => {
    // Sharma Ji owes 1000. Pays 300.
    // Step 1: Preview
    const pRes = recordCreditPayment({
      customer_name: 'Sharma Ji',
      amount: 300.00,
      payment_mode: 'CASH',
      confirm: false
    }, db);

    assert.strictEqual(pRes.ok, true);
    assert.ok(pRes.preview);
    assert.strictEqual(pRes.preview.current_balance, 1000.00);
    assert.strictEqual(pRes.preview.balance_after, 700.00);

    // Verify DB still unchanged
    assert.strictEqual(getCustomerBalance(db, 1), 1000.00);

    // Step 2: Confirm in next turn
    incrementTurn();
    const cRes = recordCreditPayment({
      customer_name: 'Sharma Ji',
      amount: 300.00,
      payment_mode: 'CASH',
      confirm: true
    }, db);

    assert.strictEqual(cRes.ok, true);
    assert.strictEqual(cRes.amount_paid, 300.00);
    assert.strictEqual(cRes.new_outstanding_balance, 700.00);

    // Verify DB updated
    assert.strictEqual(getCustomerBalance(db, 1), 700.00);

    // Verify ledger entry
    const lastEntry = db.prepare('SELECT * FROM credit_ledger WHERE customer_id = 1 ORDER BY entry_id DESC LIMIT 1').get();
    assert.strictEqual(lastEntry.type, 'PAYMENT');
    assert.strictEqual(lastEntry.amount, 300.00);
  });

  test('Overpayment exceeding outstanding balance is rejected', () => {
    // Sharma Ji owes 1000. Attempting to pay 1500.
    const res = recordCreditPayment({
      customer_name: 'Sharma Ji',
      amount: 1500.00,
      confirm: false
    }, db);

    assert.strictEqual(res.ok, false);
    assert.match(res.error, /exceeds current outstanding balance/i);
    assert.match(res.error, /1000/);
  });

  test('Negative or zero payment amount is rejected', () => {
    const zeroRes = recordCreditPayment({
      customer_name: 'Sharma Ji',
      amount: 0,
      confirm: false
    }, db);
    assert.strictEqual(zeroRes.ok, false);
    assert.match(zeroRes.error, /positive number/i);

    const negRes = recordCreditPayment({
      customer_name: 'Sharma Ji',
      amount: -250,
      confirm: false
    }, db);
    assert.strictEqual(negRes.ok, false);
    assert.match(negRes.error, /positive number/i);
  });

  test('Payment on account with zero balance is rejected', () => {
    // Rajesh Kumar has 0 balance
    const res = recordCreditPayment({
      customer_name: 'Rajesh Kumar',
      amount: 100,
      confirm: false
    }, db);

    assert.strictEqual(res.ok, false);
    assert.match(res.error, /no outstanding balance/i);
  });
});
