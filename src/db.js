/**
 * DukaanDost - Database Initialization & Shared Helpers
 * SQLite connection via better-sqlite3 with foreign keys enabled,
 * schema loading, and financial/customer helper utilities.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config();

const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dukaandost.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * Rounds monetary amounts to 2 decimal places.
 * @param {number} amount
 * @returns {number}
 */
function roundMoney(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Returns formatted date and weekday info.
 * @param {Date} [dateObj=new Date()]
 * @returns {{ dateString: string, weekday: string, fullString: string }}
 */
function getTodayDate(dateObj = new Date()) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const dateString = `${yyyy}-${mm}-${dd}`;
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekday = weekdays[dateObj.getDay()];
  return {
    dateString,
    weekday,
    fullString: `${dateString} (${weekday})`
  };
}

/**
 * Opens or retrieves a SQLite database instance and applies schema.sql.
 * Accepts a custom path override (e.g., ':memory:' for tests).
 * @param {string} [dbPath]
 * @returns {import('better-sqlite3').Database}
 */
function initDb(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  // Apply schema
  if (fs.existsSync(SCHEMA_PATH)) {
    const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schemaSql);
  }

  return db;
}

// Module-level default DB instance
let defaultDbInstance = null;

/**
 * Returns the default singleton DB instance.
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (!defaultDbInstance) {
    defaultDbInstance = initDb(DEFAULT_DB_PATH);
  }
  return defaultDbInstance;
}

/**
 * Calculates current outstanding balance for a customer.
 * Balance = SUM(DEBIT) - SUM(PAYMENT)
 * @param {import('better-sqlite3').Database} db
 * @param {number} customerId
 * @returns {number}
 */
function getCustomerBalance(db, customerId) {
  const row = db.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END), 0) AS total_debit,
      COALESCE(SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END), 0) AS total_payment
    FROM credit_ledger
    WHERE customer_id = ?
  `).get(customerId);

  const balance = (row.total_debit || 0) - (row.total_payment || 0);
  return roundMoney(balance);
}

/**
 * Resolves a customer by customer_id or customer_name/phone with fuzzy matching.
 * Handles "Sharma ji", "sharma ji", "Sharma" gracefully.
 * @param {import('better-sqlite3').Database} db
 * @param {{ customer_id?: number, customer_name?: string }} query
 * @returns {{ customer?: object, candidates?: object[], error?: string }}
 */
function resolveCustomer(db, { customer_id, customer_name }) {
  if (customer_id) {
    const customer = db.prepare(`SELECT * FROM customers WHERE customer_id = ?`).get(customer_id);
    if (!customer) {
      return { error: `Customer with ID ${customer_id} not found.` };
    }
    return { customer };
  }

  if (!customer_name || typeof customer_name !== 'string' || !customer_name.trim()) {
    return { error: 'Customer name or ID is required.' };
  }

  const rawName = customer_name.trim();

  // 1. Direct exact match (case-insensitive) on name or phone
  const exact = db.prepare(`
    SELECT * FROM customers 
    WHERE LOWER(name) = LOWER(?) OR phone = ?
  `).get(rawName, rawName);

  if (exact) {
    return { customer: exact };
  }

  // 2. Normalize by stripping honorifics like "ji", "bhai", "sahab", "uncle"
  const stripped = rawName
    .replace(/\b(ji|bhai|sahab|uncle|aunty|shree|mr|mrs)\b/gi, '')
    .trim();

  let candidates = [];
  if (stripped.length >= 2) {
    candidates = db.prepare(`
      SELECT * FROM customers 
      WHERE LOWER(name) LIKE LOWER(?)
    `).all(`%${stripped}%`);
  } else {
    candidates = db.prepare(`
      SELECT * FROM customers 
      WHERE LOWER(name) LIKE LOWER(?)
    `).all(`%${rawName}%`);
  }

  if (candidates.length === 1) {
    return { customer: candidates[0] };
  }

  if (candidates.length > 1) {
    return {
      candidates: candidates.map(c => ({
        customer_id: c.customer_id,
        name: c.name,
        phone: c.phone,
        credit_limit: c.credit_limit
      })),
      error: `Multiple customers matched "${customer_name}". Please clarify which one: ${candidates.map(c => `${c.name} (ID: ${c.customer_id}, Phone: ${c.phone})`).join(', ')}`
    };
  }

  return { error: `Customer "${customer_name}" not found in records.` };
}

// Global user-turn counter to enforce confirmation across user turns
let currentTurn = 1;

function getTurn() {
  return currentTurn;
}

function incrementTurn() {
  currentTurn += 1;
  return currentTurn;
}

function setTurn(turn) {
  currentTurn = typeof turn === 'number' ? turn : 1;
  return currentTurn;
}

function resetTurn() {
  currentTurn = 1;
  return currentTurn;
}

module.exports = {
  roundMoney,
  getTodayDate,
  initDb,
  getDb,
  getCustomerBalance,
  resolveCustomer,
  getTurn,
  incrementTurn,
  setTurn,
  resetTurn,
  DEFAULT_DB_PATH,
  SCHEMA_PATH
};

