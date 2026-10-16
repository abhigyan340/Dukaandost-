/**
 * DukaanDost - Credit Ledger Tool Module
 * Handles customer balance queries and credit payment recording with 2-step confirmation.
 */

const crypto = require('crypto');
const { getDb, roundMoney, getTodayDate, getCustomerBalance, resolveCustomer, getTurn } = require('../db');


// Module-level pending credit payments store
const pendingPayments = new Map();

/**
 * Computes a hash for pending credit payment preview.
 * @param {number} customerId
 * @param {number} amount
 * @param {string} paymentMode
 * @returns {string}
 */
function computePaymentHash(customerId, amount, paymentMode) {
  return crypto
    .createHash('sha256')
    .update(`${customerId}:${roundMoney(amount)}:${(paymentMode || 'CASH').toUpperCase()}`)
    .digest('hex');
}

/**
 * Clears pending payments (useful in tests).
 */
function clearPendingPayments() {
  pendingPayments.clear();
}

/**
 * Gets customer outstanding balance, limit, headroom, and recent ledger history.
 * Resolves "Sharma ji", "sharma ji", "Sharma" smoothly.
 * @param {{ customer_id?: number, customer_name?: string }} params
 * @param {import('better-sqlite3').Database} [customDb] Optional custom DB handle
 * @returns {object}
 */
function getCustomerBalanceTool(params, customDb) {
  try {
    const { customer_id, customer_name } = params || {};
    const db = customDb || getDb();

    const res = resolveCustomer(db, { customer_id, customer_name });
    if (res.error) {
      return {
        ok: false,
        error: res.error,
        candidates: res.candidates
      };
    }

    const customer = res.customer;
    const balance = getCustomerBalance(db, customer.customer_id);
    const headroom = roundMoney(customer.credit_limit - balance);

    // Recent 10 ledger entries
    const recentLedger = db.prepare(`
      SELECT entry_id, amount, type, entry_date, bill_id, note
      FROM credit_ledger
      WHERE customer_id = ?
      ORDER BY entry_id DESC
      LIMIT 10
    `).all(customer.customer_id);

    return {
      ok: true,
      customer_id: customer.customer_id,
      name: customer.name,
      phone: customer.phone,
      outstanding_balance: balance,
      credit_limit: customer.credit_limit,
      available_headroom: headroom,
      recent_transactions: recentLedger.map(t => ({
        entry_id: t.entry_id,
        date: t.entry_date,
        type: t.type,
        amount: t.amount,
        bill_id: t.bill_id,
        note: t.note
      }))
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to retrieve customer balance: ${err.message}`
    };
  }
}

/**
 * Records a payment against customer's credit balance.
 * Requires 2-step confirmation (preview then confirm) before modifying financial records.
 * @param {{ customer_id?: number, customer_name?: string, amount: number, payment_mode?: string, confirm?: boolean }} params
 * @param {import('better-sqlite3').Database} [customDb] Optional custom DB handle
 * @returns {object}
 */
function recordCreditPayment(params, customDb) {
  try {
    const { customer_id, customer_name, amount, payment_mode = 'CASH', confirm = false } = params || {};
    const db = customDb || getDb();
    const today = getTodayDate().dateString;

    // Validate amount
    const paymentAmount = Number(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return {
        ok: false,
        error: `Invalid payment amount "${amount}". Amount must be a positive number greater than 0.`
      };
    }

    // Resolve customer
    const res = resolveCustomer(db, { customer_id, customer_name });
    if (res.error) {
      return {
        ok: false,
        error: res.error,
        candidates: res.candidates
      };
    }

    const customer = res.customer;
    const currentBalance = getCustomerBalance(db, customer.customer_id);

    if (currentBalance <= 0) {
      return {
        ok: false,
        error: `${customer.name} currently has no outstanding balance (Balance: Rs. ${currentBalance.toFixed(2)}).`
      };
    }

    // Reject if payment exceeds outstanding balance
    if (roundMoney(paymentAmount) > currentBalance) {
      return {
        ok: false,
        error: `Payment amount Rs. ${paymentAmount.toFixed(2)} exceeds current outstanding balance of Rs. ${currentBalance.toFixed(2)} for ${customer.name}.`
      };
    }

    const normalizedMode = (payment_mode || 'CASH').trim().toUpperCase();
    const balanceAfter = roundMoney(currentBalance - paymentAmount);
    const paymentHash = computePaymentHash(customer.customer_id, paymentAmount, normalizedMode);

    // STEP 1: PREVIEW (confirm === false)
    if (!confirm) {
      const previewData = {
        paymentHash,
        customer_id: customer.customer_id,
        customer_name: customer.name,
        amount: roundMoney(paymentAmount),
        payment_mode: normalizedMode,
        current_balance: currentBalance,
        balance_after: balanceAfter,
        status: 'PENDING_CONFIRMATION',
        message: `Please confirm: Record payment of Rs. ${paymentAmount.toFixed(2)} (${normalizedMode}) for ${customer.name}? Current balance: Rs. ${currentBalance.toFixed(2)}, Balance after: Rs. ${balanceAfter.toFixed(2)}.`
      };

      pendingPayments.set(paymentHash, {
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
    const pending = pendingPayments.get(paymentHash);
    if (!pending) {
      return {
        ok: false,
        error: 'No matching pending payment preview found. You must preview the payment with confirm: false and get user confirmation before calling confirm: true.'
      };
    }

    // Enforce turn boundary: confirm must be in a subsequent turn
    if (pending.createdAtTurn !== undefined && pending.createdAtTurn >= getTurn()) {
      return {
        ok: false,
        error: 'Please show this preview to the cashier and wait for their confirmation first.'
      };
    }

    // Execute payment insert in transaction
    const executePayment = db.transaction(() => {
      // Re-verify current balance
      const recheckedBalance = getCustomerBalance(db, customer.customer_id);
      if (roundMoney(paymentAmount) > recheckedBalance) {
        throw new Error(`Customer balance changed. Current balance: Rs. ${recheckedBalance.toFixed(2)}.`);
      }

      const stmt = db.prepare(`
        INSERT INTO credit_ledger (customer_id, amount, type, entry_date, bill_id, note)
        VALUES (?, ?, 'PAYMENT', ?, NULL, ?)
      `);

      stmt.run(
        customer.customer_id,
        roundMoney(paymentAmount),
        today,
        `${normalizedMode} payment received towards udhaar balance`
      );
    });

    executePayment();
    pendingPayments.delete(paymentHash);

    const newBalance = getCustomerBalance(db, customer.customer_id);

    return {
      ok: true,
      message: `Payment of Rs. ${paymentAmount.toFixed(2)} successfully recorded for ${customer.name}!`,
      customer_id: customer.customer_id,
      customer_name: customer.name,
      amount_paid: roundMoney(paymentAmount),
      payment_mode: normalizedMode,
      previous_balance: currentBalance,
      new_outstanding_balance: newBalance
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to record payment: ${err.message}`
    };
  }
}

module.exports = {
  get_customer_balance: getCustomerBalanceTool,
  getCustomerBalance: getCustomerBalanceTool,
  record_credit_payment: recordCreditPayment,
  recordCreditPayment,
  clearPendingPayments
};
