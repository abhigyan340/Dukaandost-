/**
 * DukaanDost - Inventory Tool Module
 * Handles stock updates (with 2-step preview/confirm), low stock alerts, and expiry inspections.
 */

const crypto = require('crypto');
const { getDb, getTodayDate, getTurn } = require('../db');

// Module-level pending stock updates store
// Key: updateHash, Value: pending preview object
const pendingStockUpdates = new Map();

/**
 * Computes a deterministic hash for a pending stock update preview.
 * @param {number} productId
 * @param {number} quantityToAdd
 * @returns {string}
 */
function computeUpdateHash(productId, quantityToAdd) {
  return crypto
    .createHash('sha256')
    .update(`${productId}:${quantityToAdd}`)
    .digest('hex');
}

/**
 * Clears pending stock updates (used in tests or session reset).
 */
function clearPendingStockUpdates() {
  pendingStockUpdates.clear();
}

/**
 * Adds stock quantity to a product with a 2-step preview/confirm flow.
 * confirm=false (default): validates and returns a preview without writing.
 * confirm=true: applies the update only if a matching preview exists and
 *               the Fix-2 turn rule is satisfied.
 * Rejects zero, negative, or non-numeric values.
 *
 * @param {{ product_id: number, quantity_to_add: number, confirm?: boolean }} params
 * @param {import('better-sqlite3').Database} [customDb] Optional custom DB handle
 * @returns {object}
 */
function updateStock(params, customDb) {
  try {
    const { product_id, quantity_to_add, confirm = false } = params || {};
    const db = customDb || getDb();

    const productId = Number(product_id);
    const qtyToAdd = Number(quantity_to_add);

    if (!productId || isNaN(productId)) {
      return {
        ok: false,
        error: 'A valid product_id is required.'
      };
    }

    if (isNaN(qtyToAdd) || qtyToAdd <= 0) {
      return {
        ok: false,
        error: `Invalid quantity "${quantity_to_add}". Quantity to add must be a positive number.`
      };
    }

    const prod = db.prepare(`SELECT product_id, name, stock_qty, unit FROM products WHERE product_id = ?`).get(productId);
    if (!prod) {
      return {
        ok: false,
        error: `Product with ID ${productId} not found.`
      };
    }

    const oldStock = prod.stock_qty;
    const newStock = oldStock + qtyToAdd;
    const updateHash = computeUpdateHash(productId, qtyToAdd);

    // STEP 1: PREVIEW (confirm === false)
    if (!confirm) {
      const previewData = {
        updateHash,
        product_id: prod.product_id,
        name: prod.name,
        unit: prod.unit,
        current_stock: oldStock,
        quantity_to_add: qtyToAdd,
        new_stock: newStock,
        status: 'PENDING_CONFIRMATION',
        message: `Stock preview for "${prod.name}": current stock ${oldStock} ${prod.unit}, adding ${qtyToAdd} ${prod.unit}, new stock will be ${newStock} ${prod.unit}. Please confirm to apply.`
      };

      pendingStockUpdates.set(updateHash, {
        previewData,
        createdAt: Date.now(),
        createdAtTurn: getTurn()
      });

      return {
        ok: true,
        preview: previewData
      };
    }

    // STEP 2: CONFIRMATION (confirm === true)
    const pending = pendingStockUpdates.get(updateHash);
    if (!pending) {
      return {
        ok: false,
        error: 'No matching pending stock update preview found. You must preview the update with confirm: false and get user confirmation before calling confirm: true.'
      };
    }

    // Enforce turn boundary: confirm must be in a subsequent turn
    if (pending.createdAtTurn !== undefined && pending.createdAtTurn >= getTurn()) {
      return {
        ok: false,
        error: 'Please show this preview to the cashier and wait for their confirmation first.'
      };
    }

    db.prepare(`UPDATE products SET stock_qty = ? WHERE product_id = ?`).run(newStock, productId);

    pendingStockUpdates.delete(updateHash);

    return {
      ok: true,
      product_id: prod.product_id,
      name: prod.name,
      old_stock: oldStock,
      added_quantity: qtyToAdd,
      new_stock: newStock,
      unit: prod.unit,
      message: `Stock for "${prod.name}" updated successfully: ${oldStock} -> ${newStock} ${prod.unit}.`
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to update stock: ${err.message}`
    };
  }
}

/**
 * Alerts for products with stock below a given threshold (default: 10), sorted ascending.
 * @param {{ threshold?: number }} params
 * @param {import('better-sqlite3').Database} [customDb] Optional custom DB handle
 * @returns {object}
 */
function lowStockAlert(params, customDb) {
  try {
    const db = customDb || getDb();
    const threshold = (params && typeof params.threshold === 'number' && params.threshold >= 0)
      ? params.threshold
      : 10;

    const rows = db.prepare(`
      SELECT product_id, name, category, unit_price, stock_qty, unit, expiry_date
      FROM products
      WHERE stock_qty < ?
      ORDER BY stock_qty ASC, name ASC
    `).all(threshold);

    return {
      ok: true,
      threshold,
      count: rows.length,
      items: rows.map(r => ({
        product_id: r.product_id,
        name: r.name,
        category: r.category,
        stock_qty: r.stock_qty,
        unit: r.unit,
        unit_price: r.unit_price,
        status: r.stock_qty === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK'
      }))
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to check low stock: ${err.message}`
    };
  }
}

/**
 * Lists products expiring within N days (default: 7) and already expired products.
 * @param {{ days?: number }} params
 * @param {import('better-sqlite3').Database} [customDb] Optional custom DB handle
 * @returns {object}
 */
function expiringSoon(params, customDb) {
  try {
    const db = customDb || getDb();
    const days = (params && typeof params.days === 'number' && params.days > 0)
      ? params.days
      : 7;

    const today = getTodayDate().dateString;

    // Calculate future cutoff date
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + days);
    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const cutoffDate = `${yyyy}-${mm}-${dd}`;

    // 1. Expiring soon: expiry_date >= today AND expiry_date <= cutoffDate
    const expiringRows = db.prepare(`
      SELECT product_id, name, category, unit_price, stock_qty, unit, expiry_date
      FROM products
      WHERE expiry_date IS NOT NULL
        AND expiry_date >= ?
        AND expiry_date <= ?
      ORDER BY expiry_date ASC, name ASC
    `).all(today, cutoffDate);

    // 2. Already expired: expiry_date < today
    const expiredRows = db.prepare(`
      SELECT product_id, name, category, unit_price, stock_qty, unit, expiry_date
      FROM products
      WHERE expiry_date IS NOT NULL
        AND expiry_date < ?
      ORDER BY expiry_date ASC, name ASC
    `).all(today);

    return {
      ok: true,
      days_window: days,
      today,
      cutoff_date: cutoffDate,
      expiring_soon_count: expiringRows.length,
      expiring_soon: expiringRows.map(r => ({
        product_id: r.product_id,
        name: r.name,
        category: r.category,
        stock_qty: r.stock_qty,
        unit: r.unit,
        expiry_date: r.expiry_date
      })),
      already_expired_count: expiredRows.length,
      already_expired: expiredRows.map(r => ({
        product_id: r.product_id,
        name: r.name,
        category: r.category,
        stock_qty: r.stock_qty,
        unit: r.unit,
        expiry_date: r.expiry_date
      }))
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to check expiring items: ${err.message}`
    };
  }
}

module.exports = {
  update_stock: updateStock,
  updateStock,
  low_stock_alert: lowStockAlert,
  lowStockAlert,
  expiring_soon: expiringSoon,
  expiringSoon,
  clearPendingStockUpdates
};
