# DukaanDost: Test Prompts and Execution Records

Model configured: gemini-3.8-flash | Database: SQLite, seeded with `npm run seed`

## How to read this document

This file has two kinds of evidence, and each is labelled:

- **Real agent reply (Part A):** one conversation captured from the live agent through the CLI.
- **Tool-level output (Parts B and C):** the tool calls were executed directly against the seeded SQLite database through the tool registry in `src/agent.js`. The JSON shown is the real output from the database. The cashier inputs shown in these sections ("simulated input") were supplied by the tester to drive the two-step flow; the LLM was not involved in these runs.

**Limitation:** the Gemini API free-tier daily quota was exhausted during testing, so only the one live agent reply in Part A could be captured. The conversational agent replies for the 5 mandatory prompts were not captured. The tool-level results for those prompts are in Part B. Part A and Parts B and C were run at different times, so some stock numbers differ slightly between them (for example, Maggi stock was 57 in Part A and 60 in Part B).

---

## Part A: Real agent reply (live CLI, fuzzy product matching)

This is not one of the 5 mandatory prompts. It shows the agent matching a fuzzy product name against the database and offering both variants.

**You:** *(replace this line with the exact message you typed)*

**DukaanDost:**

Namaste! Main DukaanDost hoon. Here are the search results for **"Maggi"**:

1. **Maggi 2-Minute Noodles Masala 70g** (ID: `1`)
   - **Price:** Rs. 14 / pack
   - **Stock Available:** 57 packs
   - **GST:** 12%
   - **Expiry Date:** 13-Apr-2027

2. **Maggi Atta Noodles 75g** (ID: `2`)
   - **Price:** Rs. 20 / pack
   - **Stock Available:** 39 packs
   - **GST:** 12%
   - **Expiry Date:** 14-Mar-2027

Please let me know if you would like to create a bill, update stock, or check anything else!

---

## Part B: The 5 mandatory prompts, tool-level output

### 1. Prompt: "Bill for Sharma ji: 2 Maggi, 1 kg sugar, 1 Amul butter - put it on udhaar."

**Step 1: Variant ambiguity.** The tool returns two Maggi variants, so the agent must ask which one is meant.

- Tool call: `search_product({ query: "maggi" })`
- Real database output:

```json
{
  "ok": true,
  "count": 2,
  "matches": [
    {
      "product_id": 1,
      "name": "Maggi 2-Minute Noodles Masala 70g",
      "category": "Snacks",
      "unit_price": 14,
      "stock_qty": 60,
      "gst_percent": 12,
      "expiry_date": "2027-04-13",
      "unit": "pack",
      "expired": false
    },
    {
      "product_id": 2,
      "name": "Maggi Atta Noodles 75g",
      "category": "Snacks",
      "unit_price": 20,
      "stock_qty": 40,
      "gst_percent": 12,
      "expiry_date": "2027-03-14",
      "unit": "pack",
      "expired": false
    }
  ]
}
```

*Agent reply: not captured (API quota exhausted). See Part A for a real reply to a Maggi search.*

**Step 2: Itemised bill preview (confirm = false).** Simulated input: cashier chooses "Maggi 2-Minute Masala Noodles".

- Tool call:

```json
create_bill({
  "customer_name": "Sharma Ji",
  "payment_mode": "CREDIT",
  "items": [
    { "product_id": 1, "quantity": 2 },
    { "product_id": 8, "quantity": 1 },
    { "product_id": 19, "quantity": 1 }
  ],
  "confirm": false
})
```

- Real database output (nothing is written at this step):

```json
{
  "ok": true,
  "preview": {
    "cartHash": "9803aed7c443b37c978e7efe75dfac78b31e7dba3965ff1862d250c21c66137b",
    "customer_id": 1,
    "customer_name": "Sharma Ji",
    "payment_mode": "CREDIT",
    "items": [
      {
        "product_id": 1,
        "name": "Maggi 2-Minute Noodles Masala 70g",
        "quantity": 2,
        "unit": "pack",
        "unit_price": 14,
        "line_amount": 28,
        "gst_percent": 12,
        "line_gst": 3.36
      },
      {
        "product_id": 8,
        "name": "Sugar (per kg)",
        "quantity": 1,
        "unit": "kg",
        "unit_price": 44,
        "line_amount": 44,
        "gst_percent": 5,
        "line_gst": 2.2
      },
      {
        "product_id": 19,
        "name": "Amul Butter 100g",
        "quantity": 1,
        "unit": "pack",
        "unit_price": 58,
        "line_amount": 58,
        "gst_percent": 12,
        "line_gst": 6.96
      }
    ],
    "subtotal": 130,
    "total_gst": 12.52,
    "grand_total": 142.52,
    "credit_info": {
      "customer_id": 1,
      "customer_name": "Sharma Ji",
      "current_balance": 898.9,
      "credit_limit": 2000,
      "headroom": 1101.1,
      "balance_after": 1041.42
    },
    "warnings": [
      "Notice: \"Amul Butter 100g\" expires in 4 day(s) on 2026-10-19."
    ],
    "status": "PENDING_CONFIRMATION",
    "message": "Bill preview generated. Please confirm with the customer before saving (confirm: true)."
  }
}
```

**Step 3: Confirmation and atomic save (confirm = true).** Simulated input: cashier confirms.

- Tool call:

```json
create_bill({
  "customer_name": "Sharma Ji",
  "payment_mode": "CREDIT",
  "items": [
    { "product_id": 1, "quantity": 2 },
    { "product_id": 8, "quantity": 1 },
    { "product_id": 19, "quantity": 1 }
  ],
  "confirm": true
})
```

- Real database output:

```json
{
  "ok": true,
  "message": "Bill #17 successfully created and saved!",
  "bill_id": 17,
  "bill_date": "2026-10-15",
  "customer_name": "Sharma Ji",
  "payment_mode": "CREDIT",
  "items": [
    {
      "product_id": 1,
      "name": "Maggi 2-Minute Noodles Masala 70g",
      "quantity": 2,
      "unit": "pack",
      "unit_price": 14,
      "line_amount": 28,
      "gst_percent": 12,
      "line_gst": 3.36
    },
    {
      "product_id": 8,
      "name": "Sugar (per kg)",
      "quantity": 1,
      "unit": "kg",
      "unit_price": 44,
      "line_amount": 44,
      "gst_percent": 5,
      "line_gst": 2.2
    },
    {
      "product_id": 19,
      "name": "Amul Butter 100g",
      "quantity": 1,
      "unit": "pack",
      "unit_price": 58,
      "line_amount": 58,
      "gst_percent": 12,
      "line_gst": 6.96
    }
  ],
  "subtotal": 130,
  "total_gst": 12.52,
  "grand_total": 142.52,
  "new_credit_balance": 1041.42
}
```

Effects recorded in the database: bill #17 in `bills`; 3 rows in `bill_items`; stock reduced for product 1 (60 to 58), product 8 (120 to 119) and product 19 (25 to 24); DEBIT entry #7 of Rs. 142.52 in `credit_ledger`, linked to bill #17.

---

### 2. Prompt: "How much does Sharma ji owe me?"

- Tool call: `get_customer_balance({ "customer_name": "Sharma Ji" })`
- Real database output:

```json
{
  "ok": true,
  "customer_id": 1,
  "name": "Sharma Ji",
  "phone": "9876543210",
  "outstanding_balance": 1041.42,
  "credit_limit": 2000,
  "available_headroom": 958.58,
  "recent_transactions": [
    {
      "entry_id": 7,
      "date": "2026-10-15",
      "type": "DEBIT",
      "amount": 142.52,
      "bill_id": 17,
      "note": "Credit purchase - Bill #17"
    },
    {
      "entry_id": 5,
      "date": "2026-10-11",
      "type": "PAYMENT",
      "amount": 500,
      "bill_id": null,
      "note": "Cash payment towards credit balance"
    },
    {
      "entry_id": 3,
      "date": "2026-10-05",
      "type": "DEBIT",
      "amount": 761.18,
      "bill_id": 9,
      "note": "Credit bill #9"
    },
    {
      "entry_id": 1,
      "date": "2026-09-23",
      "type": "DEBIT",
      "amount": 637.72,
      "bill_id": 3,
      "note": "Credit bill #3"
    }
  ]
}
```

*Agent reply: not captured (API quota exhausted).*

---

### 3. Prompt: "Sharma ji paid 500 cash today."

**Step 1: Payment preview (confirm = false).**

- Tool call:

```json
record_credit_payment({
  "customer_name": "Sharma Ji",
  "amount": 500,
  "payment_mode": "CASH",
  "confirm": false
})
```

- Real database output (nothing is written at this step):

```json
{
  "ok": true,
  "preview": {
    "paymentHash": "16c7f8220817926d97d541d0fcc77f23e76e3226e976129e5261c4e05161b264",
    "customer_id": 1,
    "customer_name": "Sharma Ji",
    "amount": 500,
    "payment_mode": "CASH",
    "current_balance": 1041.42,
    "balance_after": 541.42,
    "status": "PENDING_CONFIRMATION",
    "message": "Please confirm: Record payment of Rs. 500.00 (CASH) for Sharma Ji? Current balance: Rs. 1041.42, Balance after: Rs. 541.42."
  }
}
```

**Step 2: Confirmation (confirm = true).** Simulated input: cashier confirms.

- Tool call:

```json
record_credit_payment({
  "customer_name": "Sharma Ji",
  "amount": 500,
  "payment_mode": "CASH",
  "confirm": true
})
```

- Real database output:

```json
{
  "ok": true,
  "message": "Payment of Rs. 500.00 successfully recorded for Sharma Ji!",
  "customer_id": 1,
  "customer_name": "Sharma Ji",
  "amount_paid": 500,
  "payment_mode": "CASH",
  "previous_balance": 1041.42,
  "new_outstanding_balance": 541.42
}
```

*Agent reply: not captured (API quota exhausted).*

---

### 4. Prompt: "Which items will expire this week?"

- Tool call: `expiring_soon({ "days": 7 })`
- Real database output:

```json
{
  "ok": true,
  "days_window": 7,
  "today": "2026-10-15",
  "cutoff_date": "2026-10-22",
  "expiring_soon_count": 6,
  "expiring_soon": [
    {
      "product_id": 21,
      "name": "Amul Gold Full Cream Milk 500ml",
      "category": "Dairy",
      "stock_qty": 16,
      "unit": "pouch",
      "expiry_date": "2026-10-16"
    },
    {
      "product_id": 20,
      "name": "Amul Taaza Fresh Toned Milk 500ml",
      "category": "Dairy",
      "stock_qty": 18,
      "unit": "pouch",
      "expiry_date": "2026-10-17"
    },
    {
      "product_id": 23,
      "name": "Britannia Brown Bread 400g",
      "category": "Dairy",
      "stock_qty": 5,
      "unit": "pack",
      "expiry_date": "2026-10-17"
    },
    {
      "product_id": 22,
      "name": "Mother Dairy Paneer 200g",
      "category": "Dairy",
      "stock_qty": 8,
      "unit": "pack",
      "expiry_date": "2026-10-18"
    },
    {
      "product_id": 19,
      "name": "Amul Butter 100g",
      "category": "Dairy",
      "stock_qty": 24,
      "unit": "pack",
      "expiry_date": "2026-10-19"
    },
    {
      "product_id": 24,
      "name": "Epigamia Greek Yogurt Strawberry 100g",
      "category": "Dairy",
      "stock_qty": 4,
      "unit": "cup",
      "expiry_date": "2026-10-20"
    }
  ],
  "already_expired_count": 2,
  "already_expired": [
    {
      "product_id": 25,
      "name": "Kwality Walls Vanilla Ice Cream Cup 100ml",
      "category": "Dairy",
      "stock_qty": 6,
      "unit": "cup",
      "expiry_date": "2026-10-10"
    },
    {
      "product_id": 26,
      "name": "Heritage Fresh Dahi 200g",
      "category": "Dairy",
      "stock_qty": 3,
      "unit": "cup",
      "expiry_date": "2026-10-13"
    }
  ]
}
```

*Agent reply: not captured (API quota exhausted).*

---

### 5. Prompt: "What were my top 5 selling items this month?"

- Tool call: `top_selling_products({ "limit": 5 })`
- Real database output:

```json
{
  "ok": true,
  "start_date": "2026-10-01",
  "end_date": "2026-10-15",
  "limit": 5,
  "top_products": [
    {
      "product_id": 1,
      "name": "Maggi 2-Minute Noodles Masala 70g",
      "category": "Snacks",
      "unit": "pack",
      "total_quantity_sold": 32,
      "total_revenue": 448
    },
    {
      "product_id": 8,
      "name": "Sugar (per kg)",
      "category": "Staples",
      "unit": "kg",
      "total_quantity_sold": 11,
      "total_revenue": 484
    },
    {
      "product_id": 19,
      "name": "Amul Butter 100g",
      "category": "Dairy",
      "unit": "pack",
      "total_quantity_sold": 8,
      "total_revenue": 464
    },
    {
      "product_id": 28,
      "name": "Parle-G Original Glucose Biscuits 250g",
      "category": "Biscuits",
      "unit": "pack",
      "total_quantity_sold": 8,
      "total_revenue": 200
    },
    {
      "product_id": 2,
      "name": "Maggi Atta Noodles 75g",
      "category": "Snacks",
      "unit": "pack",
      "total_quantity_sold": 6,
      "total_revenue": 120
    }
  ]
}
```

*Agent reply: not captured (API quota exhausted).*

---

## Part C: Business rule violations blocked in code (tool-level output)

### Violation 1: Selling more than the available stock

Scenario: a cashier tries to bill 100 packs of Amul Butter when only 24 are in stock.

```json
create_bill({
  "items": [{ "product_id": 19, "quantity": 100 }],
  "payment_mode": "CASH",
  "confirm": false
})
```

Real output:

```json
{
  "ok": false,
  "error": "Insufficient stock for \"Amul Butter 100g\". Available: 24 pack, requested: 100 pack."
}
```

### Violation 2: Credit bill above the customer's credit limit

Scenario: Sunita Devi (limit Rs. 1000.00, balance Rs. 912.40, headroom Rs. 87.60) tries to buy 1 bag of Aashirvaad Atta 5kg (Rs. 245.00) on udhaar.

```json
create_bill({
  "customer_name": "Sunita Devi",
  "items": [{ "product_id": 10, "quantity": 1 }],
  "payment_mode": "CREDIT",
  "confirm": false
})
```

Real output:

```json
{
  "ok": false,
  "error": "Credit limit exceeded for Sunita Devi. Current balance: Rs. 912.40, Credit limit: Rs. 1000.00, Available headroom: Rs. 87.60. This bill of Rs. 245.00 cannot be placed on credit.",
  "current_balance": 912.4,
  "credit_limit": 1000,
  "headroom": 87.6,
  "bill_total": 245
}
```

### Violation 3: Selling an expired product

Scenario: a cashier tries to bill Kwality Walls Vanilla Ice Cream Cup (expired on 2026-10-10).

```json
create_bill({
  "items": [{ "product_id": 25, "quantity": 1 }],
  "payment_mode": "CASH",
  "confirm": false
})
```

Real output:

```json
{
  "ok": false,
  "error": "Cannot sell \"Kwality Walls Vanilla Ice Cream Cup 100ml\". Product expired on 2026-10-10."
}
```

### Violation 4: Payment larger than the outstanding balance

Scenario: after the Rs. 500 payment above, Sharma Ji's balance is Rs. 541.42, and the cashier tries to record Rs. 1000.00.

```json
record_credit_payment({
  "customer_name": "Sharma Ji",
  "amount": 1000,
  "payment_mode": "CASH",
  "confirm": false
})
```

Real output:

```json
{
  "ok": false,
  "error": "Payment amount Rs. 1000.00 exceeds current outstanding balance of Rs. 541.42 for Sharma Ji."
}
```

---

## Automated tests

`npm test` runs the unit tests against in-memory SQLite databases. Latest run: 30 passing, 0 failing.