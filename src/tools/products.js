/**
 * DukaanDost - Products Tool Module
 * Handles product search with fuzzy matching, tokenized search,
 * stock and expiry status inspection.
 */

const { getDb, getTodayDate } = require('../db');

/**
 * Searches for products matching the query.
 * Tokenizes search query so that "maggi noodles" matches "Maggi 2-Minute Noodles Masala 70g".
 * @param {{ query: string }} params
 * @param {import('better-sqlite3').Database} [customDb] Optional custom DB handle (for testing)
 * @returns {{ ok: boolean, matches?: Array<object>, message?: string, error?: string }}
 */
function searchProduct({ query }, customDb) {
  try {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return {
        ok: false,
        error: 'Please provide a product name or keyword to search.'
      };
    }

    const db = customDb || getDb();
    const today = getTodayDate().dateString;

    // Tokenize query into alphanumeric words
    const tokens = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 0 && !['a', 'an', 'the', 'of', 'in', 'kg', 'gm', 'g', 'ml', 'l', 'packet', 'pack'].includes(t));

    let rows = [];

    if (tokens.length === 0) {
      // Fallback to raw query if all tokens were filtered
      const rawTerm = `%${query.trim()}%`;
      rows = db.prepare(`
        SELECT product_id, name, category, unit_price, stock_qty, gst_percent, expiry_date, unit
        FROM products
        WHERE name LIKE ? OR category LIKE ?
        ORDER BY name ASC
      `).all(rawTerm, rawTerm);
    } else {
      // Match all tokens across name or category using parameter placeholders
      const conditions = tokens.map(() => `(LOWER(name) LIKE ? OR LOWER(category) LIKE ?)`).join(' AND ');
      const params = [];
      for (const t of tokens) {
        params.push(`%${t}%`, `%${t}%`);
      }

      const sql = `
        SELECT product_id, name, category, unit_price, stock_qty, gst_percent, expiry_date, unit
        FROM products
        WHERE ${conditions}
        ORDER BY name ASC
      `;

      rows = db.prepare(sql).all(...params);
    }

    if (rows.length === 0) {
      return {
        ok: true,
        matches: [],
        message: `No products found matching "${query}". Try searching with a different brand or generic item name.`
      };
    }

    // Annotate with expired flag and near-expiry status
    const matches = rows.map(item => {
      const isExpired = Boolean(item.expiry_date && item.expiry_date < today);
      return {
        product_id: item.product_id,
        name: item.name,
        category: item.category,
        unit_price: item.unit_price,
        stock_qty: item.stock_qty,
        gst_percent: item.gst_percent,
        expiry_date: item.expiry_date,
        unit: item.unit,
        expired: isExpired
      };
    });

    return {
      ok: true,
      count: matches.length,
      matches
    };
  } catch (err) {
    return {
      ok: false,
      error: `Error searching products: ${err.message}`
    };
  }
}

module.exports = {
  search_product: searchProduct,
  searchProduct
};
