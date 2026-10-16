/**
 * DukaanDost - Inventory Tests
 * Tests update_stock validation, low_stock_alert threshold filtering,
 * and expiring_soon window calculation using an in-memory DB.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { initDb, getTodayDate, resetTurn, incrementTurn } = require('../src/db');
const { updateStock, lowStockAlert, expiringSoon, clearPendingStockUpdates } = require('../src/tools/inventory');

describe('Inventory Tools', () => {
  let db;
  const today = getTodayDate().dateString;

  // Helper to compute relative date string
  function getRelDate(daysOffset) {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  beforeEach(() => {
    clearPendingStockUpdates();
    resetTurn();
    db = initDb(':memory:');

    db.prepare(`
      INSERT INTO products (product_id, name, category, unit_price, stock_qty, gst_percent, expiry_date, unit)
      VALUES 
        (1, 'Sugar 1kg', 'Staples', 44.00, 50, 5, ?, 'kg'),
        (2, 'Amul Butter 100g', 'Dairy', 58.00, 8, 12, ?, 'pack'),
        (3, 'Fresh Milk 500ml', 'Dairy', 27.00, 4, 5, ?, 'pouch'),
        (4, 'Expired Yogurt', 'Dairy', 30.00, 2, 5, ?, 'cup'),
        (5, 'Toilet Cleaner', 'Household', 99.00, 0, 18, ?, 'bottle')
    `).run(
      getRelDate(180),  // Sugar: +180 days
      getRelDate(3),    // Butter: +3 days (expiring soon, stock 8)
      getRelDate(5),    // Milk: +5 days (expiring soon, stock 4)
      getRelDate(-3),   // Yogurt: -3 days (already expired, stock 2)
      getRelDate(365)   // Cleaner: +365 days (out of stock 0)
    );
  });

  describe('update_stock', () => {
    test('Adds stock correctly and returns old and new values', () => {
      // Preview first, then confirm in next turn
      const pRes = updateStock({ product_id: 1, quantity_to_add: 25, confirm: false }, db);
      assert.strictEqual(pRes.ok, true);

      incrementTurn();
      const res = updateStock({ product_id: 1, quantity_to_add: 25, confirm: true }, db);

      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.old_stock, 50);
      assert.strictEqual(res.added_quantity, 25);
      assert.strictEqual(res.new_stock, 75);

      const inDb = db.prepare('SELECT stock_qty FROM products WHERE product_id = 1').get().stock_qty;
      assert.strictEqual(inDb, 75);
    });

    test('Rejects zero quantity', () => {
      const res = updateStock({ product_id: 1, quantity_to_add: 0 }, db);
      assert.strictEqual(res.ok, false);
      assert.match(res.error, /positive number/i);
    });

    test('Rejects negative quantity', () => {
      const res = updateStock({ product_id: 1, quantity_to_add: -10 }, db);
      assert.strictEqual(res.ok, false);
      assert.match(res.error, /positive number/i);
    });

    test('Rejects non-numeric quantity', () => {
      const res = updateStock({ product_id: 1, quantity_to_add: 'ten' }, db);
      assert.strictEqual(res.ok, false);
      assert.match(res.error, /positive number/i);
    });

    test('Rejects unknown product_id', () => {
      const res = updateStock({ product_id: 9999, quantity_to_add: 10 }, db);
      assert.strictEqual(res.ok, false);
      assert.match(res.error, /not found/i);
    });

    test('Preview does not change stock', () => {
      const res = updateStock({ product_id: 1, quantity_to_add: 25, confirm: false }, db);

      assert.strictEqual(res.ok, true);
      assert.ok(res.preview);
      assert.strictEqual(res.preview.current_stock, 50);
      assert.strictEqual(res.preview.quantity_to_add, 25);
      assert.strictEqual(res.preview.new_stock, 75);
      assert.strictEqual(res.preview.status, 'PENDING_CONFIRMATION');

      // Stock must NOT have changed
      const inDb = db.prepare('SELECT stock_qty FROM products WHERE product_id = 1').get().stock_qty;
      assert.strictEqual(inDb, 50);
    });

    test('Confirm without prior preview is rejected', () => {
      clearPendingStockUpdates();
      const res = updateStock({ product_id: 1, quantity_to_add: 25, confirm: true }, db);

      assert.strictEqual(res.ok, false);
      assert.match(res.error, /preview/i);

      // Stock unchanged
      const inDb = db.prepare('SELECT stock_qty FROM products WHERE product_id = 1').get().stock_qty;
      assert.strictEqual(inDb, 50);
    });

    test('Confirmed update changes stock; same-turn confirm is rejected', () => {
      // Preview
      const pRes = updateStock({ product_id: 1, quantity_to_add: 25, confirm: false }, db);
      assert.strictEqual(pRes.ok, true);

      // Same-turn confirm must be rejected
      const sameTurnRes = updateStock({ product_id: 1, quantity_to_add: 25, confirm: true }, db);
      assert.strictEqual(sameTurnRes.ok, false);
      assert.match(sameTurnRes.error, /Please show this preview to the cashier and wait for their confirmation first/i);

      // Stock still unchanged
      assert.strictEqual(db.prepare('SELECT stock_qty FROM products WHERE product_id = 1').get().stock_qty, 50);

      // Advance turn and confirm
      incrementTurn();
      const cRes = updateStock({ product_id: 1, quantity_to_add: 25, confirm: true }, db);
      assert.strictEqual(cRes.ok, true);
      assert.strictEqual(cRes.old_stock, 50);
      assert.strictEqual(cRes.new_stock, 75);

      // Stock updated in DB
      assert.strictEqual(db.prepare('SELECT stock_qty FROM products WHERE product_id = 1').get().stock_qty, 75);
    });
  });

  describe('low_stock_alert', () => {
    test('Returns items below default threshold (10) sorted ascending by stock', () => {
      const res = lowStockAlert({}, db);

      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.threshold, 10);
      // Items with stock < 10: Toilet Cleaner (0), Expired Yogurt (2), Fresh Milk (4), Amul Butter (8)
      assert.strictEqual(res.count, 4);

      // Verify ascending order
      const stocks = res.items.map(i => i.stock_qty);
      assert.deepStrictEqual(stocks, [0, 2, 4, 8]);

      // Verify out of stock status
      assert.strictEqual(res.items[0].status, 'OUT_OF_STOCK');
      assert.strictEqual(res.items[1].status, 'LOW_STOCK');
    });

    test('Respects custom threshold parameter', () => {
      const res = lowStockAlert({ threshold: 5 }, db);

      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.threshold, 5);
      // Items with stock < 5: Cleaner (0), Yogurt (2), Milk (4)
      assert.strictEqual(res.count, 3);
    });
  });

  describe('expiring_soon', () => {
    test('Separates products expiring within window from already-expired items', () => {
      const res = expiringSoon({ days: 7 }, db);

      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.days_window, 7);

      // Expiring soon: Butter (+3) and Milk (+5)
      assert.strictEqual(res.expiring_soon_count, 2);
      const expiringNames = res.expiring_soon.map(i => i.name);
      assert.ok(expiringNames.includes('Amul Butter 100g'));
      assert.ok(expiringNames.includes('Fresh Milk 500ml'));

      // Already expired: Yogurt (-3)
      assert.strictEqual(res.already_expired_count, 1);
      assert.strictEqual(res.already_expired[0].name, 'Expired Yogurt');
    });

    test('Defaults window to 7 days if not provided', () => {
      const res = expiringSoon(undefined, db);
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.days_window, 7);
      assert.strictEqual(res.expiring_soon_count, 2);
    });
  });
});
