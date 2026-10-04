/** Read-only inventory and dashboard endpoints. */

import config from '../config/env.js';
import {
  createItem,
  deleteItem,
  listInventory,
  listLowStock,
  listRecentActions,
  updateItem,
} from '../services/inventoryService.js';
import { logger } from '../utils/logger.js';
import {
  ALL_HEALTHY,
  ERRORS,
  itemAddedMessage,
  itemDeletedMessage,
  itemUpdatedMessage,
} from '../utils/messages.js';

const TAG = 'inventory-api';

/**
 * The service returns either {ok: true, item} or {ok: false, code, message, status}.
 * Turning that into a response lives here so all three endpoints report a
 * failure the same way.
 */
function sendFailure(res, result) {
  return res.status(result.status ?? 400).json({
    status: 'error',
    code: result.code,
    message: result.message,
  });
}

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

/** POST /api/items - add an item to the catalogue by hand. */
export async function postItem(req, res) {
  try {
    const result = await createItem(req.body);
    if (!result.ok) return sendFailure(res, result);

    return res.status(201).json({
      status: 'success',
      message: itemAddedMessage(result.item),
      item: result.item,
    });
  } catch (err) {
    logger.error(TAG, 'postItem failed:', err?.message || err);
    return res.status(500).json({ status: 'error', message: ERRORS.DB_FAILED });
  }
}

/** PUT /api/items/:id - edit name, unit, quantity or threshold. */
export async function putItem(req, res) {
  try {
    const result = await updateItem(req.params.id, req.body);
    if (!result.ok) return sendFailure(res, result);

    return res.status(200).json({
      status: 'success',
      message: itemUpdatedMessage(result.item),
      item: result.item,
    });
  } catch (err) {
    logger.error(TAG, 'putItem failed:', err?.message || err);
    return res.status(500).json({ status: 'error', message: ERRORS.DB_FAILED });
  }
}

/** DELETE /api/items/:id */
export async function removeItem(req, res) {
  try {
    const result = await deleteItem(req.params.id);
    if (!result.ok) return sendFailure(res, result);

    return res.status(200).json({
      status: 'success',
      message: itemDeletedMessage(result.item.name),
      item: result.item,
    });
  } catch (err) {
    logger.error(TAG, 'removeItem failed:', err?.message || err);
    return res.status(500).json({ status: 'error', message: ERRORS.DB_FAILED });
  }
}
