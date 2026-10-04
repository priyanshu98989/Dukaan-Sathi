/**
 * Idempotent seed for the single demo shop.
 *
 * Runs automatically on server start when the collection is empty, and can be
 * run by hand with `npm run seed`. Restarting never duplicates a row and never
 * overwrites stock the shopkeeper has already changed.
 */

import mongoose from 'mongoose';
import config from './config/env.js';
import InventoryItem from './models/InventoryItem.js';
import { SEED_ITEMS } from './services/itemAliases.js';
import { logger } from './utils/logger.js';

const TAG = 'seed';

/**
 * @param {{force?: boolean}} options
 * @returns {Promise<{seeded: number, skipped: number}>}
 */
export async function seedInventory({ force = false } = {}) {
  const existing = await InventoryItem.countDocuments();

  if (existing > 0 && !force) {
    logger.info(TAG, `inventory already has ${existing} item(s) - seed skipped`);
    return { seeded: 0, skipped: existing };
  }

  if (force && existing > 0) {
    await InventoryItem.deleteMany({});
    logger.info(TAG, `cleared ${existing} existing item(s) for re-seed`);
  }

  // insertMany is a single batch; the unique index on `name` makes this safe
  // against a concurrent double start-up.
  const docs = await InventoryItem.insertMany(
    SEED_ITEMS.map((i) => ({ ...i })),
    { ordered: true },
  );

  logger.info(TAG, `seeded ${docs.length} item(s) for ${config.shopName}`);
  return { seeded: docs.length, skipped: 0 };
}

/** Only seed when the DB is empty. Safe to call on every boot. */
export async function autoSeed() {
  try {
    return await seedInventory({ force: false });
  } catch (err) {
    logger.error(TAG, 'auto-seed failed:', err?.message || err);
    return { seeded: 0, skipped: 0, error: err };
  }
}

// Allow `node seed.js` to run it standalone.
const isDirectRun =
  process.argv[1] &&
  import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/').replace(/^\/+/, '')}`).href;

if (isDirectRun) {
  (async () => {
    let code = 0;
    try {
      await mongoose.connect(config.mongoUri);
      logger.info(TAG, `connected to ${config.mongoUri}`);
      const result = await seedInventory({ force: process.argv.includes('--force') });

      const items = await InventoryItem.find().sort({ _id: 1 }).lean();
      logger.info(TAG, `shop "${config.shopName}" now holds:`);
      for (const i of items) {
        const status = i.quantity < i.lowStockThreshold ? 'Low' : 'Normal';
        logger.info(TAG, `  - ${i.name}: ${i.quantity} ${i.unit} (threshold ${i.lowStockThreshold}) [${status}]`);
      }
      logger.info(TAG, `done: seeded ${result.seeded}, skipped ${result.skipped}`);
    } catch (err) {
      logger.error(TAG, 'seed failed:', err?.message || err);
      code = 1;
    } finally {
      await mongoose.connection.close();
    }
    process.exit(code);
  })();
}
