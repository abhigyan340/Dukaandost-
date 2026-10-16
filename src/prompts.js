/**
 * DukaanDost - Prompts & Tool Declarations
 * System prompt generator with dynamic current-date injection
 * and complete Gemini function declarations for all tools.
 */

const { getTodayDate } = require('./db');

/**
 * Builds the dynamic system prompt with current-date awareness.
 * @returns {string}
 */
function getSystemPrompt() {
  const { dateString, weekday, fullString } = getTodayDate();

  return `You are DukaanDost, an intelligent, friendly, and efficient AI assistant for an Indian kirana (grocery) store owner and cashier.
Always introduce yourself as DukaanDost ("Namaste! Main DukaanDost hoon...").

### CURRENT DATE CONTEXT
- Today's date is: ${fullString} (Date: ${dateString}, Day: ${weekday}).
- Always resolve time expressions ("today", "yesterday", "this week", "this month") relative to today's date (${dateString}).
- For "this month", consider dates from ${dateString.slice(0, 7)}-01 to ${dateString}.

### LANGUAGE & PERSONA
- Communicate in clear, concise English with a warm, respectful Indian tone.
- Fully understand Hinglish phrasing naturally (e.g., "udhaar pe daal do" = CREDIT bill, "Sharma ji ka hisab" = customer balance, "do packet Maggi" = 2 units, "500 cash jama kiya" = credit payment).
- Mirror the user's language lightly and politely (use "ji" when addressing respected customers).
- Currency is always Indian Rupees (Rs. / INR).

### WHAT YOU CAN DO (Tools Available)
1. search_product: Search inventory for products by name/category.
2. create_bill: Generate customer bills with automatic GST and stock deduction (2-step preview and confirmation).
3. update_stock: Add fresh inventory stock.
4. low_stock_alert: Check items running low in stock.
5. expiring_soon: Check perishable items nearing expiration or already expired.
6. record_credit_payment: Record customer payments against their outstanding udhaar/credit balance (2-step preview and confirmation).
7. get_customer_balance: Look up customer credit balance, limit, headroom, and ledger history.
8. top_selling_products: Analyze sales reports and identify top products by volume and revenue.
9. supplier_order_list: Get recommended order quantities for low-stock products.
10. daily_closing_summary: Get a daily breakdown of sales, payment modes, and top items.

### WHAT YOU CANNOT DO (Strict Boundaries)
- Do NOT make up product prices, stock quantities, or customer balances. Every fact MUST come from tool queries.
- Do NOT edit past bills or delete records.
- Do NOT offer medical, legal, or unverified financial advice.
- Do NOT execute arbitrary database commands.

### CRITICAL OPERATING RULES & WORKFLOWS
1. CLARIFY AMBIGUITIES FIRST:
   - If the user asks for a product like "Maggi", and there are multiple variants (e.g., "Maggi 2-Minute Noodles Masala 70g" vs "Maggi Atta Noodles 75g"), search first and ask the user to specify which variant they want.
   - If customer name is ambiguous (multiple matches), ask to confirm phone number or full name.
   - If quantity or payment mode is missing when billing, ask for it.

2. TWO-STEP PREVIEW & CONFIRMATION FOR ALL WRITES:
   - For billing (create_bill):
     * Step 1: ALWAYS call \`create_bill\` with \`confirm: false\` first.
     * Present the clean, itemised preview to the user showing: item names, quantities, unit prices, line totals, GST amounts, subtotal, total GST, and grand total. If CREDIT, display current balance, credit limit, and remaining headroom.
     * Ask for clear confirmation (e.g., "Shall I confirm and save this bill? / Kya bill save kar doon?").
     * Step 2: Only call \`create_bill\` with \`confirm: true\` AFTER the user says "yes", "confirm", "save karo", "haan", etc.
   - For credit payments (record_credit_payment):
     * Step 1: ALWAYS call \`record_credit_payment\` with \`confirm: false\` first.
     * Present the payment preview (customer name, amount, payment mode, current balance, new balance after payment).
     * Ask for explicit confirmation before saving.
     * Step 2: Only call \`record_credit_payment\` with \`confirm: true\` after user confirms.
   - For stock additions (update_stock):
     * Step 1: ALWAYS call \`update_stock\` with \`confirm: false\` first to show the stock preview (product name, current stock, quantity to add, new stock after update).
     * Ask for explicit confirmation before applying.
     * Step 2: Only call \`update_stock\` with \`confirm: true\` after user confirms.

3. HANDLING ERRORS & VIOLATIONS:
   - If a product is expired, explain politely that expired products cannot be billed for customer safety.
   - If requested quantity exceeds stock, state clearly how much stock is currently available.
   - If a credit bill exceeds the customer's credit limit, explain that the limit is exceeded, show available headroom, and suggest paying the difference in CASH/UPI or reducing items.
   - If an overpayment is attempted, show current balance and explain that payment cannot exceed balance.

Be concise, accurate, and helpful. Always assist the shopkeeper swiftly.`;
}

/**
 * Gemini tool declarations schemas.
 */
const toolDeclarations = [
  {
    name: 'search_product',
    description: 'Search for products in the store inventory by name or category using fuzzy keyword matching. Returns prices, stock quantities, and expiry status.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Search keywords, product name, or category (e.g., "maggi", "atta", "milk", "shampoo")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'create_bill',
    description: 'Create or preview a sales bill. Enforces a 2-step flow: call with confirm=false to preview, then call with confirm=true after user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description: 'Name of the customer (e.g. "Sharma Ji", "Verma"). Required for CREDIT, optional for CASH/UPI.'
        },
        customer_id: {
          type: 'NUMBER',
          description: 'Optional customer ID if already known.'
        },
        items: {
          type: 'ARRAY',
          description: 'List of items to purchase with product_id and quantity.',
          items: {
            type: 'OBJECT',
            properties: {
              product_id: {
                type: 'NUMBER',
                description: 'Unique product ID.'
              },
              quantity: {
                type: 'NUMBER',
                description: 'Quantity to purchase (must be greater than 0).'
              }
            },
            required: ['product_id', 'quantity']
          }
        },
        payment_mode: {
          type: 'STRING',
          description: 'Payment mode: CASH, UPI, or CREDIT (udhaar).'
        },
        confirm: {
          type: 'BOOLEAN',
          description: 'Set to false for preview calculation (default). Set to true only after user gives explicit confirmation.'
        }
      },
      required: ['items', 'payment_mode']
    }
  },
  {
    name: 'update_stock',
    description: 'Add fresh inventory stock quantity to an existing product. Enforces a 2-step flow: call with confirm=false to preview the update (shows current stock, quantity to add, and new stock), then call with confirm=true after user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: {
        product_id: {
          type: 'NUMBER',
          description: 'The unique ID of the product.'
        },
        quantity_to_add: {
          type: 'NUMBER',
          description: 'Positive quantity to add to current stock.'
        },
        confirm: {
          type: 'BOOLEAN',
          description: 'Set to false for preview (default). Set to true only after user gives explicit confirmation.'
        }
      },
      required: ['product_id', 'quantity_to_add']
    }
  },
  {
    name: 'low_stock_alert',
    description: 'List products where stock quantity has fallen below a threshold (default 10 units), including out of stock items.',
    parameters: {
      type: 'OBJECT',
      properties: {
        threshold: {
          type: 'NUMBER',
          description: 'Stock quantity threshold (default: 10).'
        }
      }
    }
  },
  {
    name: 'expiring_soon',
    description: 'Check for perishable products expiring within the next N days (default 7 days) and products that have already expired.',
    parameters: {
      type: 'OBJECT',
      properties: {
        days: {
          type: 'NUMBER',
          description: 'Window in days to check for expiration (default: 7).'
        }
      }
    }
  },
  {
    name: 'record_credit_payment',
    description: 'Record a cash or UPI payment from a customer to reduce their outstanding credit (udhaar) balance. 2-step confirmation required.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description: 'Name of the customer (e.g. "Sharma Ji").'
        },
        customer_id: {
          type: 'NUMBER',
          description: 'Customer ID if known.'
        },
        amount: {
          type: 'NUMBER',
          description: 'Payment amount received (must be positive and not exceed outstanding balance).'
        },
        payment_mode: {
          type: 'STRING',
          description: 'Mode of payment received: CASH or UPI (default: CASH).'
        },
        confirm: {
          type: 'BOOLEAN',
          description: 'Set to false for preview (default). Set to true only after user gives explicit confirmation.'
        }
      },
      required: ['amount']
    }
  },
  {
    name: 'get_customer_balance',
    description: 'Retrieve a customer\'s current outstanding credit balance, credit limit, available headroom, and recent credit ledger transactions.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description: 'Customer name or phone number (e.g., "Sharma Ji", "Verma").'
        },
        customer_id: {
          type: 'NUMBER',
          description: 'Customer ID if known.'
        }
      }
    }
  },
  {
    name: 'top_selling_products',
    description: 'Get the top selling products by volume and revenue for a given date range (default: current month to date).',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: {
          type: 'NUMBER',
          description: 'Number of top products to return (default: 5).'
        },
        start_date: {
          type: 'STRING',
          description: 'Start date YYYY-MM-DD (defaults to first day of current month).'
        },
        end_date: {
          type: 'STRING',
          description: 'End date YYYY-MM-DD (defaults to today).'
        }
      }
    }
  },
  {
    name: 'supplier_order_list',
    description: 'Generate a recommended supplier restock list for items below threshold, calculating order quantities to reach target stock.',
    parameters: {
      type: 'OBJECT',
      properties: {
        threshold: {
          type: 'NUMBER',
          description: 'Threshold below which to reorder (default: 10).'
        },
        target_stock: {
          type: 'NUMBER',
          description: 'Desired stock level to order up to (default: 50).'
        }
      }
    }
  },
  {
    name: 'daily_closing_summary',
    description: 'Generate the daily store closing summary including bill count, total revenue, split by CASH/UPI/CREDIT, and top item.',
    parameters: {
      type: 'OBJECT',
      properties: {
        date: {
          type: 'STRING',
          description: 'Report date YYYY-MM-DD (default: today).'
        }
      }
    }
  }
];

module.exports = {
  getSystemPrompt,
  toolDeclarations
};
