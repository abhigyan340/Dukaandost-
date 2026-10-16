/**
 * DukaanDost - Reports & Business Analytics Tool Module
 * Handles top selling products analysis, supplier order recommendations,
 * and daily closing summaries.
 */

const { getDb, roundMoney, getTodayDate } = require('../db');

/**
 * Returns top selling products by quantity sold within a date range.
 * Default date range: current month to date. Default limit: 5.
 * @param {{ limit?: number, start_date?: string, end_date?: string }} params
 * @param {import('better-sqlite3').Database} [customDb] Optional custom DB handle
 * @returns {object}
 */
function topSellingProducts(params, customDb) {
  try {
    const db = customDb || getDb();
    const today = getTodayDate().dateString;

    // Default to start of current month: YYYY-MM-01
    const [yyyy, mm] = today.split('-');
    const defaultStartDate = `${yyyy}-${mm}-01`;

    const startDate = (params && params.start_date) || defaultStartDate;
    const endDate = (params && params.end_date) || today;
    const limit = (params && typeof params.limit === 'number' && params.limit > 0) ? params.limit : 5;

    const rows = db.prepare(`
      SELECT 
        p.product_id,
        p.name,
        p.category,
        p.unit,
        ROUND(SUM(bi.quantity), 2) AS total_quantity_sold,
        ROUND(SUM(bi.quantity * bi.price), 2) AS total_revenue
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.bill_id
      JOIN products p ON bi.product_id = p.product_id
      WHERE b.bill_date >= ? AND b.bill_date <= ?
      GROUP BY p.product_id, p.name, p.category, p.unit
      ORDER BY total_quantity_sold DESC, total_revenue DESC
      LIMIT ?
    `).all(startDate, endDate, limit);

    return {
      ok: true,
      start_date: startDate,
      end_date: endDate,
      limit,
      top_products: rows.map(r => ({
        product_id: r.product_id,
        name: r.name,
        category: r.category,
        unit: r.unit,
        total_quantity_sold: r.total_quantity_sold,
        total_revenue: roundMoney(r.total_revenue)
      }))
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to fetch top selling products: ${err.message}`
    };
  }
}

/**
 * BONUS TOOL: Recommends inventory quantities to order for low stock items.
 * @param {{ threshold?: number, target_stock?: number }} params
 * @param {import('better-sqlite3').Database} [customDb] Optional custom DB handle
 * @returns {object}
 */
function supplierOrderList(params, customDb) {
  try {
    const db = customDb || getDb();
    const threshold = (params && typeof params.threshold === 'number' && params.threshold >= 0) ? params.threshold : 10;
    const targetStock = (params && typeof params.target_stock === 'number' && params.target_stock > threshold) ? params.target_stock : 50;

    const rows = db.prepare(`
      SELECT product_id, name, category, unit_price, stock_qty, unit
      FROM products
      WHERE stock_qty < ?
      ORDER BY stock_qty ASC, name ASC
    `).all(threshold);

    let totalEstimatedCost = 0;
    const orderItems = rows.map(r => {
      const orderQty = Math.max(0, targetStock - r.stock_qty);
      // Rough wholesale cost estimate (~85% of retail price)
      const estimatedWholesalePrice = roundMoney(r.unit_price * 0.85);
      const estimatedCost = roundMoney(orderQty * estimatedWholesalePrice);
      totalEstimatedCost = roundMoney(totalEstimatedCost + estimatedCost);

      return {
        product_id: r.product_id,
        name: r.name,
        category: r.category,
        current_stock: r.stock_qty,
        target_stock: targetStock,
        order_quantity: orderQty,
        unit: r.unit,
        estimated_cost: estimatedCost
      };
    });

    return {
      ok: true,
      threshold,
      target_stock: targetStock,
      total_items_to_order: orderItems.length,
      estimated_total_investment: totalEstimatedCost,
      order_list: orderItems
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to generate supplier order list: ${err.message}`
    };
  }
}

/**
 * BONUS TOOL: Generates daily closing summary for store sales, split by payment modes.
 * @param {{ date?: string }} params
 * @param {import('better-sqlite3').Database} [customDb] Optional custom DB handle
 * @returns {object}
 */
function dailyClosingSummary(params, customDb) {
  try {
    const db = customDb || getDb();
    const today = getTodayDate().dateString;
    const reportDate = (params && params.date) || today;

    // Total sales & bill count
    const totals = db.prepare(`
      SELECT 
        COUNT(*) AS total_bills,
        COALESCE(SUM(total), 0) AS total_sales,
        COALESCE(SUM(subtotal), 0) AS total_subtotal,
        COALESCE(SUM(gst_amount), 0) AS total_gst
      FROM bills
      WHERE bill_date = ?
    `).get(reportDate);

    // Split by payment mode
    const modeBreakdown = db.prepare(`
      SELECT 
        payment_mode,
        COUNT(*) AS count,
        COALESCE(SUM(total), 0) AS amount
      FROM bills
      WHERE bill_date = ?
      GROUP BY payment_mode
    `).all(reportDate);

    const breakdown = {
      CASH: { count: 0, amount: 0 },
      UPI: { count: 0, amount: 0 },
      CREDIT: { count: 0, amount: 0 }
    };

    for (const b of modeBreakdown) {
      if (breakdown[b.payment_mode]) {
        breakdown[b.payment_mode] = {
          count: b.count,
          amount: roundMoney(b.amount)
        };
      }
    }

    // Top item sold on that date
    const topItem = db.prepare(`
      SELECT 
        p.name,
        SUM(bi.quantity) AS qty_sold,
        ROUND(SUM(bi.quantity * bi.price), 2) AS revenue
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.bill_id
      JOIN products p ON bi.product_id = p.product_id
      WHERE b.bill_date = ?
      GROUP BY p.product_id, p.name
      ORDER BY qty_sold DESC
      LIMIT 1
    `).get(reportDate);

    return {
      ok: true,
      report_date: reportDate,
      total_bills: totals.total_bills,
      total_sales: roundMoney(totals.total_sales),
      total_subtotal: roundMoney(totals.total_subtotal),
      total_gst: roundMoney(totals.total_gst),
      payment_breakdown: breakdown,
      top_product_of_the_day: topItem ? {
        name: topItem.name,
        quantity_sold: topItem.qty_sold,
        revenue: roundMoney(topItem.revenue)
      } : null
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to generate daily closing summary: ${err.message}`
    };
  }
}

module.exports = {
  top_selling_products: topSellingProducts,
  topSellingProducts,
  supplier_order_list: supplierOrderList,
  supplierOrderList,
  daily_closing_summary: dailyClosingSummary,
  dailyClosingSummary
};
