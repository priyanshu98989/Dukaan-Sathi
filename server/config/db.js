/** MongoDB connection lifecycle. */

import mongoose from 'mongoose';
import config from './env.js';
import { logger } from '../utils/logger.js';

const TAG = 'mongo';

let connectPromise = null;

export async function connectDb() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectPromise) return connectPromise;

  mongoose.set('strictQuery', true);
  // Never let a bad query hang a voice request forever.
  mongoose.set('bufferCommands', false);
  // NOTE: global `sanitizeFilter` is deliberately NOT enabled. It rewrites any
  // operator object into `$eq`, which silently breaks the legitimate
  // `{ quantity: { $gte: n } }` guard that stops a sale driving stock negative.
  // Sanitisation is done explicitly at the call site instead - see
  // `toSafeNumber` in services/inventoryService.js, where every number that can
  // reach a query is coerced to a finite Number first.

  connectPromise = mongoose
    .connect(config.mongoUri, {
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 20000,
      maxPoolSize: 10,
    })
    .then((m) => {
      logger.info(TAG, 'connected');
      m.connection.on('error', (err) => logger.error(TAG, 'connection error:', err?.message));
      m.connection.on('disconnected', () => logger.warn(TAG, 'disconnected'));
      m.connection.on('reconnected', () => logger.info(TAG, 'reconnected'));
      return m.connection;
    })
    .catch((err) => {
      connectPromise = null;
      logger.error(TAG, 'connect failed:', err?.message || err);
      throw err;
    });

  return connectPromise;
}

export async function disconnectDb() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.connection.close();
  logger.info(TAG, 'disconnected');
}

export { mongoose };
