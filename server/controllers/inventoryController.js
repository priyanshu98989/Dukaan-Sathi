/** Read-only inventory and dashboard endpoints. */

import config from '../config/env.js';
import { listInventory, listLowStock, listRecentActions } from '../services/inventoryService.js';
import { logger } from '../utils/logger.js';
import { ALL_HEALTHY, ERRORS } from '../utils/messages.js';

const TAG = 'inventory-api';

/** GET /api/inventory */
export async function getInventory(_req, res) {
  try {
    const items = await listInventory();
    return res.status(200).json({
      status: 'success',
      shop: config.shopName,
      count: items.length,
      items,
    });
  } catch (err) {
    logger.error(TAG, 'getInventory failed:', err?.message || err);
    return res.status(500).json({ status: 'error', message: ERRORS.DB_FAILED });
  }
}

/** GET /api/dashboard - everything the single page needs, in one request. */
export async function getDashboard(_req, res) {
  try {
    const [items, lowStockItems, recentActions] = await Promise.all([
      listInventory(),
      listLowStock(),
      listRecentActions(20),
    ]);

    return res.status(200).json({
      status: 'success',
      shop: config.shopName,
      items,
      lowStock: {
        count: lowStockItems.length,
        items: lowStockItems,
        headline: lowStockItems.length ? undefined : ALL_HEALTHY,
      },
      recentActions,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(TAG, 'getDashboard failed:', err?.message || err);
    return res.status(500).json({ status: 'error', message: ERRORS.DB_FAILED });
  }
}
