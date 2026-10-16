/**
 * DukaanDost - Database Seeder
 * Populates realistic Indian kirana store inventory, customers, past bills,
 * and credit ledger entries with dates relative to today.
 * Idempotent: wipes existing records and re-populates cleanly.
 */

const { initDb, roundMoney } = require('./db');

/**
 * Calculates a date relative to today formatted as YYYY-MM-DD.
 * @param {number} daysOffset
 * @returns {string}
 */
function getRelativeDate(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Main seeding routine.
 * @param {string} [dbPath] Optional path override
 */
function seedDatabase(dbPath) {
  const db = initDb(dbPath);

  console.log('--- DukaanDost Database Seeding Started ---');

  // Wrap seeding in a transaction for atomicity and speed
  const runSeed = db.transaction(() => {
    // 1. Clear existing data in reverse FK order
    db.exec(`
      DELETE FROM credit_ledger;
      DELETE FROM bill_items;
      DELETE FROM bills;
      DELETE FROM customers;
      DELETE FROM products;
      DELETE FROM sqlite_sequence WHERE name IN ('credit_ledger', 'bill_items', 'bills', 'customers', 'products');
    `);

    // 2. Insert Products (50 items across 8 categories)
    const insertProduct = db.prepare(`
      INSERT INTO products (name, category, unit_price, stock_qty, gst_percent, expiry_date, unit)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const products = [
      // Snacks & Noodles (includes mandatory Maggi variants)
      { name: 'Maggi 2-Minute Noodles Masala 70g', category: 'Snacks', unit_price: 14, stock_qty: 60, gst_percent: 12, expiry_date: getRelativeDate(180), unit: 'pack' },
      { name: 'Maggi Atta Noodles 75g', category: 'Snacks', unit_price: 20, stock_qty: 40, gst_percent: 12, expiry_date: getRelativeDate(150), unit: 'pack' },
      { name: "Lay's Classic Salted Potato Chips 50g", category: 'Snacks', unit_price: 20, stock_qty: 35, gst_percent: 12, expiry_date: getRelativeDate(90), unit: 'pack' },
      { name: 'Kurkure Masala Munch 85g', category: 'Snacks', unit_price: 20, stock_qty: 45, gst_percent: 12, expiry_date: getRelativeDate(90), unit: 'pack' },
      { name: "Haldiram's Bhujia Sev 200g", category: 'Snacks', unit_price: 55, stock_qty: 30, gst_percent: 12, expiry_date: getRelativeDate(120), unit: 'pack' },
      { name: "Haldiram's All In One Mixture 200g", category: 'Snacks', unit_price: 55, stock_qty: 25, gst_percent: 12, expiry_date: getRelativeDate(120), unit: 'pack' },
      { name: 'Act II Popcorn Butter Lovers 85g', category: 'Snacks', unit_price: 35, stock_qty: 20, gst_percent: 12, expiry_date: getRelativeDate(180), unit: 'pack' },

      // Staples (Sugar, Atta, Salt, Dals, Rice, Oil)
      { name: 'Sugar (per kg)', category: 'Staples', unit_price: 44, stock_qty: 120, gst_percent: 5, expiry_date: getRelativeDate(365), unit: 'kg' },
      { name: 'Tata Salt 1kg', category: 'Staples', unit_price: 28, stock_qty: 75, gst_percent: 0, expiry_date: getRelativeDate(500), unit: 'kg' },
      { name: 'Aashirvaad Shudh Chakki Atta 5kg', category: 'Staples', unit_price: 245, stock_qty: 30, gst_percent: 0, expiry_date: getRelativeDate(90), unit: 'pack' },
      { name: 'Aashirvaad Shudh Chakki Atta 10kg', category: 'Staples', unit_price: 460, stock_qty: 20, gst_percent: 0, expiry_date: getRelativeDate(90), unit: 'pack' },
      { name: 'Toor Dal Superior 1kg', category: 'Staples', unit_price: 165, stock_qty: 45, gst_percent: 0, expiry_date: getRelativeDate(180), unit: 'kg' },
      { name: 'Moong Dal Dhuli 1kg', category: 'Staples', unit_price: 140, stock_qty: 40, gst_percent: 0, expiry_date: getRelativeDate(180), unit: 'kg' },
      { name: 'Chana Dal 1kg', category: 'Staples', unit_price: 95, stock_qty: 35, gst_percent: 0, expiry_date: getRelativeDate(180), unit: 'kg' },
      { name: 'India Gate Basmati Rice Feast Rozzana 1kg', category: 'Staples', unit_price: 98, stock_qty: 50, gst_percent: 0, expiry_date: getRelativeDate(365), unit: 'kg' },
      { name: 'Fortune Sunlite Sunflower Oil 1L', category: 'Staples', unit_price: 145, stock_qty: 25, gst_percent: 5, expiry_date: getRelativeDate(240), unit: 'pouch' },
      { name: 'Dhara Kachi Ghani Mustard Oil 1L', category: 'Staples', unit_price: 160, stock_qty: 22, gst_percent: 5, expiry_date: getRelativeDate(240), unit: 'bottle' },
      { name: 'Fortune Soya Chunks 200g', category: 'Staples', unit_price: 50, stock_qty: 30, gst_percent: 5, expiry_date: getRelativeDate(200), unit: 'pack' },

      // Dairy & Perishables (Includes expiring soon & already expired)
      { name: 'Amul Butter 100g', category: 'Dairy', unit_price: 58, stock_qty: 25, gst_percent: 12, expiry_date: getRelativeDate(4), unit: 'pack' }, // Expiring in 4 days
      { name: 'Amul Taaza Fresh Toned Milk 500ml', category: 'Dairy', unit_price: 27, stock_qty: 18, gst_percent: 5, expiry_date: getRelativeDate(2), unit: 'pouch' }, // Expiring in 2 days
      { name: 'Amul Gold Full Cream Milk 500ml', category: 'Dairy', unit_price: 34, stock_qty: 16, gst_percent: 5, expiry_date: getRelativeDate(1), unit: 'pouch' }, // Expiring tomorrow
      { name: 'Mother Dairy Paneer 200g', category: 'Dairy', unit_price: 95, stock_qty: 8, gst_percent: 5, expiry_date: getRelativeDate(3), unit: 'pack' }, // Expiring in 3 days, low stock (8)
      { name: 'Britannia Brown Bread 400g', category: 'Dairy', unit_price: 50, stock_qty: 5, gst_percent: 5, expiry_date: getRelativeDate(2), unit: 'pack' }, // Expiring in 2 days, low stock (5)
      { name: 'Epigamia Greek Yogurt Strawberry 100g', category: 'Dairy', unit_price: 60, stock_qty: 4, gst_percent: 5, expiry_date: getRelativeDate(5), unit: 'cup' }, // Expiring in 5 days, low stock (4)
      { name: 'Kwality Walls Vanilla Ice Cream Cup 100ml', category: 'Dairy', unit_price: 25, stock_qty: 6, gst_percent: 18, expiry_date: getRelativeDate(-5), unit: 'cup' }, // ALREADY EXPIRED (-5 days), low stock (6)
      { name: 'Heritage Fresh Dahi 200g', category: 'Dairy', unit_price: 20, stock_qty: 3, gst_percent: 5, expiry_date: getRelativeDate(-2), unit: 'cup' }, // ALREADY EXPIRED (-2 days), low stock (3)
      { name: 'Amul Cheese Slices 200g', category: 'Dairy', unit_price: 145, stock_qty: 15, gst_percent: 12, expiry_date: getRelativeDate(45), unit: 'pack' },

      // Biscuits
      { name: 'Parle-G Original Glucose Biscuits 250g', category: 'Biscuits', unit_price: 25, stock_qty: 65, gst_percent: 18, expiry_date: getRelativeDate(180), unit: 'pack' },
      { name: 'Britannia Good Day Butter Cookies 100g', category: 'Biscuits', unit_price: 30, stock_qty: 40, gst_percent: 18, expiry_date: getRelativeDate(180), unit: 'pack' },
      { name: 'Sunfeast Dark Fantasy Choco Fills 75g', category: 'Biscuits', unit_price: 40, stock_qty: 25, gst_percent: 18, expiry_date: getRelativeDate(120), unit: 'pack' },
      { name: 'Oreo Original Chocolate Sandwich Biscuits 120g', category: 'Biscuits', unit_price: 35, stock_qty: 30, gst_percent: 18, expiry_date: getRelativeDate(180), unit: 'pack' },
      { name: 'Britannia Marie Gold Biscuits 200g', category: 'Biscuits', unit_price: 35, stock_qty: 45, gst_percent: 18, expiry_date: getRelativeDate(180), unit: 'pack' },

      // Beverages
      { name: 'Brooke Bond Red Label Tea 250g', category: 'Beverages', unit_price: 130, stock_qty: 30, gst_percent: 5, expiry_date: getRelativeDate(365), unit: 'pack' },
      { name: 'Tata Tea Gold 250g', category: 'Beverages', unit_price: 150, stock_qty: 25, gst_percent: 5, expiry_date: getRelativeDate(365), unit: 'pack' },
      { name: 'Nescafe Classic Instant Coffee 50g', category: 'Beverages', unit_price: 185, stock_qty: 20, gst_percent: 18, expiry_date: getRelativeDate(365), unit: 'jar' },
      { name: 'Bru Instant Coffee Jar 50g', category: 'Beverages', unit_price: 140, stock_qty: 18, gst_percent: 18, expiry_date: getRelativeDate(365), unit: 'jar' },
      { name: 'Coca-Cola Original 750ml', category: 'Beverages', unit_price: 40, stock_qty: 24, gst_percent: 18, expiry_date: getRelativeDate(120), unit: 'bottle' },
      { name: 'Thums Up 750ml', category: 'Beverages', unit_price: 40, stock_qty: 24, gst_percent: 18, expiry_date: getRelativeDate(120), unit: 'bottle' },
      { name: 'Maaza Mango Drink 600ml', category: 'Beverages', unit_price: 42, stock_qty: 20, gst_percent: 12, expiry_date: getRelativeDate(120), unit: 'bottle' },

      // Personal Care
      { name: 'Colgate Strong Teeth Toothpaste 100g', category: 'Personal Care', unit_price: 65, stock_qty: 35, gst_percent: 18, expiry_date: getRelativeDate(365), unit: 'pack' },
      { name: 'Dettol Original Bathing Soap 75g', category: 'Personal Care', unit_price: 40, stock_qty: 50, gst_percent: 18, expiry_date: getRelativeDate(365), unit: 'pcs' },
      { name: 'Lifebuoy Total Soap 125g', category: 'Personal Care', unit_price: 38, stock_qty: 40, gst_percent: 18, expiry_date: getRelativeDate(365), unit: 'pcs' },
      { name: 'Head & Shoulders Anti-Dandruff Shampoo 180ml', category: 'Personal Care', unit_price: 190, stock_qty: 15, gst_percent: 18, expiry_date: getRelativeDate(365), unit: 'bottle' },
      { name: 'Clinic Plus Strong & Long Shampoo 175ml', category: 'Personal Care', unit_price: 135, stock_qty: 20, gst_percent: 18, expiry_date: getRelativeDate(365), unit: 'bottle' },

      // Household (Includes items with 0 stock)
      { name: 'Surf Excel Easy Wash Detergent Powder 1kg', category: 'Household', unit_price: 145, stock_qty: 25, gst_percent: 18, expiry_date: getRelativeDate(500), unit: 'pack' },
      { name: 'Ariel Complete Detergent Powder 1kg', category: 'Household', unit_price: 195, stock_qty: 18, gst_percent: 18, expiry_date: getRelativeDate(500), unit: 'pack' },
      { name: 'Vim Dishwash Bar 135g', category: 'Household', unit_price: 15, stock_qty: 80, gst_percent: 18, expiry_date: getRelativeDate(500), unit: 'bar' },
      { name: 'Colin Glass Cleaner 500ml', category: 'Household', unit_price: 105, stock_qty: 0, gst_percent: 18, expiry_date: getRelativeDate(365), unit: 'bottle' }, // OUT OF STOCK (0)
      { name: 'Harpic Power Plus Toilet Cleaner 500ml', category: 'Household', unit_price: 99, stock_qty: 0, gst_percent: 18, expiry_date: getRelativeDate(365), unit: 'bottle' }, // OUT OF STOCK (0)

      // Spices
      { name: 'MDH Deggi Mirch Powder 100g', category: 'Spices', unit_price: 88, stock_qty: 25, gst_percent: 5, expiry_date: getRelativeDate(300), unit: 'pack' },
      { name: 'Everest Turmeric Powder 100g', category: 'Spices', unit_price: 36, stock_qty: 30, gst_percent: 5, expiry_date: getRelativeDate(300), unit: 'pack' },
      { name: 'Everest Coriander Powder 100g', category: 'Spices', unit_price: 42, stock_qty: 25, gst_percent: 5, expiry_date: getRelativeDate(300), unit: 'pack' },
      { name: 'Catch Garam Masala 100g', category: 'Spices', unit_price: 92, stock_qty: 20, gst_percent: 5, expiry_date: getRelativeDate(300), unit: 'pack' }
    ];

    for (const p of products) {
      insertProduct.run(p.name, p.category, p.unit_price, p.stock_qty, p.gst_percent, p.expiry_date, p.unit);
    }

    // 3. Insert Customers (10 customers with varied limits)
    const insertCustomer = db.prepare(`
      INSERT INTO customers (name, phone, credit_limit)
      VALUES (?, ?, ?)
    `);

    const customers = [
      { name: 'Sharma Ji', phone: '9876543210', credit_limit: 2000 },
      { name: 'Verma Ji', phone: '9876543211', credit_limit: 1500 },
      { name: 'Gupta Ji', phone: '9876543212', credit_limit: 3000 },
      { name: 'Sunita Devi', phone: '9876543213', credit_limit: 1000 },
      { name: 'Rajesh Kumar', phone: '9876543214', credit_limit: 2500 },
      { name: 'Pooja Singh', phone: '9876543215', credit_limit: 1500 },
      { name: 'Amit Patel', phone: '9876543216', credit_limit: 4000 },
      { name: 'Anil Tiwari', phone: '9876543217', credit_limit: 2000 },
      { name: 'Meena Kumari', phone: '9876543218', credit_limit: 1200 },
      { name: 'Ramesh Chawla', phone: '9876543219', credit_limit: 5000 }
    ];

    for (const c of customers) {
      insertCustomer.run(c.name, c.phone, c.credit_limit);
    }

    // 4. Insert 16 Past Bills over the last 30 days
    const insertBill = db.prepare(`
      INSERT INTO bills (customer_id, bill_date, subtotal, gst_amount, total, payment_mode)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertBillItem = db.prepare(`
      INSERT INTO bill_items (bill_id, product_id, quantity, price)
      VALUES (?, ?, ?, ?)
    `);

    const insertCreditLedger = db.prepare(`
      INSERT INTO credit_ledger (customer_id, amount, type, entry_date, bill_id, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // Helper to record a bill with items
    function recordPastBill({ customer_id, daysOffset, payment_mode, items }) {
      const billDate = getRelativeDate(daysOffset);
      let subtotal = 0;
      let gstAmount = 0;

      for (const item of items) {
        const prod = db.prepare(`SELECT unit_price, gst_percent FROM products WHERE product_id = ?`).get(item.product_id);
        const lineTotal = roundMoney(prod.unit_price * item.quantity);
        const lineGst = roundMoney(lineTotal * (prod.gst_percent / 100));
        subtotal = roundMoney(subtotal + lineTotal);
        gstAmount = roundMoney(gstAmount + lineGst);
      }

      const total = roundMoney(subtotal + gstAmount);
      const res = insertBill.run(customer_id || null, billDate, subtotal, gstAmount, total, payment_mode);
      const billId = Number(res.lastInsertRowid);

      for (const item of items) {
        const prod = db.prepare(`SELECT unit_price FROM products WHERE product_id = ?`).get(item.product_id);
        insertBillItem.run(billId, item.product_id, item.quantity, prod.unit_price);
      }

      // If credit, record ledger entry
      if (payment_mode === 'CREDIT' && customer_id) {
        insertCreditLedger.run(customer_id, total, 'DEBIT', billDate, billId, `Credit bill #${billId}`);
      }

      return { billId, total, billDate };
    }

    // Product IDs:
    // 1: Maggi Masala, 2: Maggi Atta, 8: Sugar, 9: Tata Salt, 10: Atta 5kg, 12: Toor Dal, 19: Amul Butter, 28: Parle-G, 33: Red Label Tea, 42: Surf Excel

    // Bill 1: 27 days ago - CASH (walk-in)
    recordPastBill({ customer_id: null, daysOffset: -27, payment_mode: 'CASH', items: [{ product_id: 1, quantity: 5 }, { product_id: 28, quantity: 2 }] });

    // Bill 2: 25 days ago - UPI (Rajesh Kumar)
    recordPastBill({ customer_id: 5, daysOffset: -25, payment_mode: 'UPI', items: [{ product_id: 8, quantity: 2 }, { product_id: 9, quantity: 1 }] });

    // Bill 3: 22 days ago - CREDIT (Sharma Ji, customer_id: 1) -> Bill #3
    recordPastBill({ customer_id: 1, daysOffset: -22, payment_mode: 'CREDIT', items: [{ product_id: 10, quantity: 1 }, { product_id: 12, quantity: 2 }, { product_id: 1, quantity: 4 }] });

    // Bill 4: 20 days ago - CASH (walk-in)
    recordPastBill({ customer_id: null, daysOffset: -20, payment_mode: 'CASH', items: [{ product_id: 1, quantity: 10 }, { product_id: 28, quantity: 4 }] });

    // Bill 5: 18 days ago - UPI (Gupta Ji, customer_id: 3)
    recordPastBill({ customer_id: 3, daysOffset: -18, payment_mode: 'UPI', items: [{ product_id: 16, quantity: 2 }, { product_id: 12, quantity: 1 }] });

    // Bill 6: 15 days ago - CREDIT (Verma Ji, customer_id: 2) -> Bill #6
    recordPastBill({ customer_id: 2, daysOffset: -15, payment_mode: 'CREDIT', items: [{ product_id: 10, quantity: 2 }, { product_id: 8, quantity: 2 }] });

    // Bill 7: 14 days ago - CASH (walk-in)
    recordPastBill({ customer_id: null, daysOffset: -14, payment_mode: 'CASH', items: [{ product_id: 1, quantity: 6 }, { product_id: 19, quantity: 2 }] });

    // Bill 8: 12 days ago - UPI (Amit Patel)
    recordPastBill({ customer_id: 7, daysOffset: -12, payment_mode: 'UPI', items: [{ product_id: 33, quantity: 2 }, { product_id: 8, quantity: 3 }] });

    // Bill 9: 10 days ago - CREDIT (Sharma Ji, customer_id: 1) -> Bill #9
    recordPastBill({ customer_id: 1, daysOffset: -10, payment_mode: 'CREDIT', items: [{ product_id: 10, quantity: 1 }, { product_id: 19, quantity: 3 }, { product_id: 8, quantity: 4 }, { product_id: 33, quantity: 1 }] });

    // Bill 10: 8 days ago - CASH (walk-in)
    recordPastBill({ customer_id: null, daysOffset: -8, payment_mode: 'CASH', items: [{ product_id: 1, quantity: 8 }, { product_id: 28, quantity: 5 }] });

    // Bill 11: 6 days ago - UPI (Pooja Singh)
    recordPastBill({ customer_id: 6, daysOffset: -6, payment_mode: 'UPI', items: [{ product_id: 42, quantity: 2 }, { product_id: 40, quantity: 3 }] });

    // Bill 12: 5 days ago - CREDIT (Sunita Devi, customer_id: 4) -> Bill #12
    recordPastBill({ customer_id: 4, daysOffset: -5, payment_mode: 'CREDIT', items: [{ product_id: 10, quantity: 2 }, { product_id: 12, quantity: 2 }, { product_id: 8, quantity: 2 }] });

    // Bill 13: 4 days ago - CASH (walk-in)
    recordPastBill({ customer_id: null, daysOffset: -4, payment_mode: 'CASH', items: [{ product_id: 1, quantity: 12 }, { product_id: 2, quantity: 6 }] });

    // Bill 14: 3 days ago - UPI (Anil Tiwari)
    recordPastBill({ customer_id: 8, daysOffset: -3, payment_mode: 'UPI', items: [{ product_id: 16, quantity: 1 }, { product_id: 10, quantity: 1 }] });

    // Bill 15: 1 day ago - CASH (walk-in)
    recordPastBill({ customer_id: null, daysOffset: -1, payment_mode: 'CASH', items: [{ product_id: 19, quantity: 2 }, { product_id: 8, quantity: 1 }] });

    // Bill 16: Today - UPI (walk-in)
    recordPastBill({ customer_id: null, daysOffset: 0, payment_mode: 'UPI', items: [{ product_id: 1, quantity: 4 }, { product_id: 28, quantity: 3 }] });

    // 5. Insert Payments in Credit Ledger
    // Sharma Ji pays Rs 500 4 days ago
    insertCreditLedger.run(1, 500.00, 'PAYMENT', getRelativeDate(-4), null, 'Cash payment towards credit balance');

    // Verma Ji pays Rs 200 3 days ago
    insertCreditLedger.run(2, 200.00, 'PAYMENT', getRelativeDate(-3), null, 'UPI payment towards credit balance');
  });

  runSeed();

  // Print Summary
  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const customerCount = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
  const billCount = db.prepare('SELECT COUNT(*) AS c FROM bills').get().c;
  const ledgerCount = db.prepare('SELECT COUNT(*) AS c FROM credit_ledger').get().c;

  // Verify Sharma Ji balance
  const sharma = db.prepare(`SELECT customer_id, name, credit_limit FROM customers WHERE name = 'Sharma Ji'`).get();
  const sharmaBal = db.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END), 0) AS bal
    FROM credit_ledger WHERE customer_id = ?
  `).get(sharma.customer_id).bal;

  // Verify Sunita Devi balance
  const sunita = db.prepare(`SELECT customer_id, name, credit_limit FROM customers WHERE name = 'Sunita Devi'`).get();
  const sunitaBal = db.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN type = 'PAYMENT' THEN amount ELSE 0 END), 0) AS bal
    FROM credit_ledger WHERE customer_id = ?
  `).get(sunita.customer_id).bal;

  console.log('--- DukaanDost Seed Complete ---');
  console.log(`Products: ${productCount}`);
  console.log(`Customers: ${customerCount}`);
  console.log(`Past Bills: ${billCount}`);
  console.log(`Credit Ledger Entries: ${ledgerCount}`);
  console.log(`Sharma Ji Balance: Rs. ${sharmaBal.toFixed(2)} (Limit: Rs. ${sharma.credit_limit})`);
  console.log(`Sunita Devi Balance: Rs. ${sunitaBal.toFixed(2)} (Limit: Rs. ${sunita.credit_limit}, Headroom: Rs. ${(sunita.credit_limit - sunitaBal).toFixed(2)})`);
  console.log('--------------------------------');

  return { productCount, customerCount, billCount, ledgerCount };
}

// Allow direct CLI execution: node src/seed.js
if (require.main === module) {
  try {
    seedDatabase();
  } catch (err) {
    console.error('Failed to seed database:', err);
    process.exit(1);
  }
}

module.exports = { seedDatabase };
