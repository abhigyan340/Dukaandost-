-- DukaanDost SQLite Database Schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
    product_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit_price REAL NOT NULL CHECK (unit_price > 0),
    stock_qty INTEGER NOT NULL CHECK (stock_qty >= 0),
    gst_percent REAL NOT NULL DEFAULT 0 CHECK (gst_percent >= 0),
    expiry_date TEXT, -- YYYY-MM-DD (nullable)
    unit TEXT NOT NULL DEFAULT 'pcs'
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    credit_limit REAL NOT NULL DEFAULT 2000 CHECK (credit_limit >= 0)
);

CREATE TABLE IF NOT EXISTS bills (
    bill_id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    bill_date TEXT NOT NULL,
    subtotal REAL NOT NULL CHECK (subtotal >= 0),
    gst_amount REAL NOT NULL CHECK (gst_amount >= 0),
    total REAL NOT NULL CHECK (total >= 0),
    payment_mode TEXT NOT NULL CHECK (payment_mode IN ('CASH', 'UPI', 'CREDIT')),
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE IF NOT EXISTS bill_items (
    item_id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    price REAL NOT NULL CHECK (price > 0),
    FOREIGN KEY (bill_id) REFERENCES bills(bill_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE IF NOT EXISTS credit_ledger (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    type TEXT NOT NULL CHECK (type IN ('DEBIT', 'PAYMENT')),
    entry_date TEXT NOT NULL,
    bill_id INTEGER,
    note TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
    FOREIGN KEY (bill_id) REFERENCES bills(bill_id)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_bills_customer ON bills(customer_id);
CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(bill_date);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_product ON bill_items(product_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_customer ON credit_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_bill ON credit_ledger(bill_id);
