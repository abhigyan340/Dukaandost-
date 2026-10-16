/**
 * DukaanDost - Billing Tool Module
 * Handles bill generation with a strict 2-step preview/confirm workflow,
 * stock validation, expiry checks, credit limit verification, and atomic DB transactions.
 */

const crypto = require('crypto');
const { getDb, roundMoney, getTodayDate, getCustomerBalance, resolveCustomer, getTurn } = require('../db');


// Module-level pending bills store
// Key: cartHash, Value: pending bill preview object
const pendingBills = new Map();

/**
 * Computes a deterministic hash for a cart to match preview with confirmation.
 * @param {number|null} customerId
 * @param {string} paymentMode
 * @param {Array<{ product_id: number, quantity: number }>} items
 * @returns {string}
 */
function computeCartHash(customerId, paymentMode, items) {
  const normalizedItems = (items || [])
    .map(i => ({ product_id: Number(i.product_id), quantity: Number(i.quantity) }))
    .sort((a, b) => a.product_id - b.product_id);

  const payload = JSON.stringify({
    customerId: customerId || null,
    paymentMode: (paymentMode || '').toUpperCase(),
    items: normalizedItems
  });

  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Clears pending bills (used in tests or session reset).
 */
function clearPendingBills() {
  pendingBills.clear();
}

/**
 * Creates or previews a bill. Enforces a 2-step flow in code:
 * Step 1: confirm = false -> Validates stock, expiry, credit limits; computes preview; saves pending state.
 * Step 2: confirm = true -> Checks pending preview; re-validates; executes atomic transaction.
 *
 * @param {object} params
 * @param {string} [params.customer_name]
 * @param {number} [params.customer_id]
 * @param {Array<{ product_id: number, quantity: number }>} params.items
 * @param {string} params.payment_mode CASH | UPI | CREDIT
 * @param {boolean} [params.confirm=false]
 * @param {import('better-sqlite3').Database} [customDb] Optional custom DB handle
 * @returns {object}
 */
function createBill(params, customDb) {
  try {
    const { customer_name, customer_id, items, payment_mode, confirm = false } = params || {};
    const db = customDb || getDb();
    const today = getTodayDate().dateString;

    // Validate payment mode
    if (!payment_mode || typeof payment_mode !== 'string') {
      return {
        ok: false,
        error: 'Payment mode is required. Please choose CASH, UPI, or CREDIT (udhaar).'
      };
    }

    const normalizedPaymentMode = payment_mode.trim().toUpperCase();
    if (!['CASH', 'UPI', 'CREDIT'].includes(normalizedPaymentMode)) {
      return {
        ok: false,
        error: `Invalid payment mode "${payment_mode}". Valid modes are CASH, UPI, or CREDIT.`
      };
    }

    // Customer resolution
    let customer = null;
    if (customer_id || customer_name) {
      const res = resolveCustomer(db, { customer_id, customer_name });
      if (res.error) {
        if (normalizedPaymentMode === 'CREDIT' || res.candidates) {
          return {
            ok: false,
            error: res.error,
            candidates: res.candidates
          };
        }
      } else {
        customer = res.customer;
      }
    }

    // CREDIT strictly requires a resolved customer
    if (normalizedPaymentMode === 'CREDIT' && !customer) {
      return {
        ok: false,
        error: 'A registered customer is required for CREDIT (udhaar) bills. Please provide customer name or phone.'
      };
    }

    // Validate items array
    if (!Array.isArray(items) || items.length === 0) {
      return {
        ok: false,
        error: 'Cart is empty. Please provide at least one product with quantity.'
      };
    }

    // Merge duplicate product_ids by summing quantities
    const mergedItemsMap = new Map();
    for (const item of items) {
      const productId = Number(item.product_id);
      const qty = Number(item.quantity);

      if (!productId || isNaN(productId)) {
        return {
          ok: false,
          error: `Invalid product ID "${item.product_id}".`
        };
      }

      if (!qty || isNaN(qty) || qty <= 0) {
        return {
          ok: false,
          error: `Invalid quantity for product ID ${productId}. Quantity must be a positive number.`
        };
      }

      mergedItemsMap.set(productId, roundMoney((mergedItemsMap.get(productId) || 0) + qty));
    }

    const mergedItems = Array.from(mergedItemsMap.entries()).map(([product_id, quantity]) => ({
      product_id,
      quantity
    }));

    // Item-level validation and pricing
    const validatedItems = [];
    let subtotal = 0;
    let totalGst = 0;
    const warnings = [];

    for (const item of mergedItems) {
      const productId = item.product_id;
      const qty = item.quantity;

      // Fetch latest product details from DB (price always from DB!)
      const prod = db.prepare(`
        SELECT product_id, name, unit_price, stock_qty, gst_percent, expiry_date, unit
        FROM products
        WHERE product_id = ?
      `).get(productId);

      if (!prod) {
        return {
          ok: false,
          error: `Product with ID ${productId} does not exist.`
        };
      }

      // 1. Stock validation
      if (prod.stock_qty < qty) {
        return {
          ok: false,
          error: `Insufficient stock for "${prod.name}". Available: ${prod.stock_qty} ${prod.unit}, requested: ${qty} ${prod.unit}.`
        };
      }

      // 2. Expiry validation (CANNOT sell expired products)
      if (prod.expiry_date && prod.expiry_date < today) {
        return {
          ok: false,
          error: `Cannot sell "${prod.name}". Product expired on ${prod.expiry_date}.`
        };
      }

      // Near expiry warning (within 7 days)
      if (prod.expiry_date) {
        const expDate = new Date(prod.expiry_date);
        const currDate = new Date(today);
        const diffDays = Math.ceil((expDate - currDate) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= 7) {
          warnings.push(`Notice: "${prod.name}" expires in ${diffDays} day(s) on ${prod.expiry_date}.`);
        }
      }

      // Calculations
      const lineAmount = roundMoney(prod.unit_price * qty);
      const lineGst = roundMoney(lineAmount * ((prod.gst_percent || 0) / 100));

      subtotal = roundMoney(subtotal + lineAmount);
      totalGst = roundMoney(totalGst + lineGst);

      validatedItems.push({
        product_id: prod.product_id,
        name: prod.name,
        quantity: qty,
        unit: prod.unit,
        unit_price: prod.unit_price,
        line_amount: lineAmount,
        gst_percent: prod.gst_percent,
        line_gst: lineGst
      });
    }

    const grandTotal = roundMoney(subtotal + totalGst);

    // Credit Limit Validation
    let creditInfo = null;
    if (normalizedPaymentMode === 'CREDIT' && customer) {
      const currentBalance = getCustomerBalance(db, customer.customer_id);
      const limit = customer.credit_limit;
      const headroom = roundMoney(limit - currentBalance);
      const balanceAfter = roundMoney(currentBalance + grandTotal);

      if (balanceAfter > limit) {
        return {
          ok: false,
          error: `Credit limit exceeded for ${customer.name}. Current balance: Rs. ${currentBalance.toFixed(2)}, Credit limit: Rs. ${limit.toFixed(2)}, Available headroom: Rs. ${headroom.toFixed(2)}. This bill of Rs. ${grandTotal.toFixed(2)} cannot be placed on credit.`,
          current_balance: currentBalance,
          credit_limit: limit,
          headroom: headroom,
          bill_total: grandTotal
        };
      }

      creditInfo = {
        customer_id: customer.customer_id,
        customer_name: customer.name,
        current_balance: currentBalance,
        credit_limit: limit,
        headroom: headroom,
        balance_after: balanceAfter
      };
    }

    const cartHash = computeCartHash(customer ? customer.customer_id : null, normalizedPaymentMode, validatedItems);

    // STEP 1: PREVIEW (confirm === false)
    if (!confirm) {
      const previewData = {
        cartHash,
        customer_id: customer ? customer.customer_id : null,
        customer_name: customer ? customer.name : null,
        payment_mode: normalizedPaymentMode,
        items: validatedItems,
        subtotal,
        total_gst: totalGst,
        grand_total: grandTotal,
        credit_info: creditInfo,
        warnings: warnings.length > 0 ? warnings : undefined,
        status: 'PENDING_CONFIRMATION',
        message: 'Bill preview generated. Please confirm with the customer before saving (confirm: true).'
      };

      // Store in memory for verification on confirmation
      pendingBills.set(cartHash, {
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
    // Verify that a matching pending preview exists
    const pending = pendingBills.get(cartHash);
    if (!pending) {
      return {
        ok: false,
        error: 'No matching pending bill preview found. You must preview the bill with confirm: false and get user confirmation before calling confirm: true.'
      };
    }

    // Enforce turn boundary: confirm must be in a subsequent turn
    if (pending.createdAtTurn !== undefined && pending.createdAtTurn >= getTurn()) {
      return {
        ok: false,
        error: 'Please show this preview to the cashier and wait for their confirmation first.'
      };
    }

    // Execute ATOMIC TRANSACTION
    const executeBillingTransaction = db.transaction(() => {
      // 1. Re-verify stock inside transaction
      for (const item of validatedItems) {
        const currentProd = db.prepare(`SELECT stock_qty FROM products WHERE product_id = ?`).get(item.product_id);
        if (!currentProd || currentProd.stock_qty < item.quantity) {
          throw new Error(`Stock changed unexpectedly for product ID ${item.product_id}. Available: ${currentProd ? currentProd.stock_qty : 0}.`);
        }
      }

      // 2. Insert Bill
      const insertBillStmt = db.prepare(`
        INSERT INTO bills (customer_id, bill_date, subtotal, gst_amount, total, payment_mode)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const billRes = insertBillStmt.run(
        customer ? customer.customer_id : null,
        today,
        subtotal,
        totalGst,
        grandTotal,
        normalizedPaymentMode
      );
      const billId = Number(billRes.lastInsertRowid);

      // 3. Insert Bill Items & Deduct Stock
      const insertItemStmt = db.prepare(`
        INSERT INTO bill_items (bill_id, product_id, quantity, price)
        VALUES (?, ?, ?, ?)
      `);
      const deductStockStmt = db.prepare(`
        UPDATE products
        SET stock_qty = stock_qty - ?
        WHERE product_id = ?
      `);

      for (const item of validatedItems) {
        insertItemStmt.run(billId, item.product_id, item.quantity, item.unit_price);
        deductStockStmt.run(item.quantity, item.product_id);
      }

      // 4. For CREDIT, insert DEBIT ledger entry
      if (normalizedPaymentMode === 'CREDIT' && customer) {
        const insertLedgerStmt = db.prepare(`
          INSERT INTO credit_ledger (customer_id, amount, type, entry_date, bill_id, note)
          VALUES (?, ?, 'DEBIT', ?, ?, ?)
        `);
        insertLedgerStmt.run(
          customer.customer_id,
          grandTotal,
          today,
          billId,
          `Credit purchase - Bill #${billId}`
        );
      }

      return billId;
    });

    const createdBillId = executeBillingTransaction();

    // Remove from pending store
    pendingBills.delete(cartHash);

    // Fetch updated credit info if credit bill
    let updatedBalance = null;
    if (normalizedPaymentMode === 'CREDIT' && customer) {
      updatedBalance = getCustomerBalance(db, customer.customer_id);
    }

    return {
      ok: true,
      message: `Bill #${createdBillId} successfully created and saved!`,
      bill_id: createdBillId,
      bill_date: today,
      customer_name: customer ? customer.name : 'Walk-in Customer',
      payment_mode: normalizedPaymentMode,
      items: validatedItems,
      subtotal,
      total_gst: totalGst,
      grand_total: grandTotal,
      new_credit_balance: updatedBalance !== null ? updatedBalance : undefined
    };

  } catch (err) {
    return {
      ok: false,
      error: `Billing failed: ${err.message}`
    };
  }
}

module.exports = {
  create_bill: createBill,
  createBill,
  clearPendingBills,
  computeCartHash
};
