/**
 * Every user-facing string in the app lives here.
 *
 * Rule: the shopkeeper must never see a stack trace, an HTTP status code or an
 * English technical message. Anything that reaches the screen comes from this file.
 */

import mongoose from 'mongoose';
import { normaliseKey } from '../services/itemAliases.js';

const { Schema } = mongoose;

const InventoryItemSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true,
      unique: true,
      maxlength: [60, 'Item name is too long'],
    },
    /**
     * Lower-cased, punctuation-free form of `name`, and the reason "aata" and
     * "Aata" cannot both exist.
     *
     * A MongoDB collation index would do this too, but a stored key keeps the
     * lookup identical to the normaliseKey() the voice path already uses, so
     * "Aata" spoken in any casing hits the same row without a second comparison
     * path.
     *
     * The index is partial so it can be built on a database written before this
     * field existed: MongoDB stores a missing key as null, and a plain unique
     * index would refuse to build against more than one such row.
     */
    nameKey: {
      type: String,
      required: [true, 'Item name key is required'],
      trim: true,
      maxlength: [60, 'Item name key is too long'],
      index: {
        unique: true,
        partialFilterExpression: { nameKey: { $type: 'string' } },
      },
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [0, 'Quantity cannot be negative'],
      validate: {
        validator: Number.isFinite,
        message: 'Quantity must be a finite number',
      },
    },
    unit: {
      type: String,
      required: [true, 'Unit is required'],
      trim: true,
      enum: {
        values: ['kg', 'L', 'packets'],
        message: 'Unit must be one of: kg, L, packets',
      },
    },
    lowStockThreshold: {
      type: Number,
      required: [true, 'Low stock threshold is required'],
      min: [0, 'Low stock threshold cannot be negative'],
    },
  },
  { timestamps: true, versionKey: false },
);

/** "Low" when below the threshold - the shopkeeper cares about running out. */
InventoryItemSchema.virtual('status').get(function status() {
  return this.quantity < this.lowStockThreshold ? 'Low' : 'Normal';
});

/**
 * Derive nameKey from name on every create/save, so it can never be forgotten or
 * left stale after a rename. Updates that go through findOneAndUpdate do not run
 * document middleware, so those set nameKey explicitly - see inventoryService.
 */
InventoryItemSchema.pre('validate', function assignNameKey() {
  if (typeof this.name === 'string' && this.name.trim()) {
    this.nameKey = normaliseKey(this.name);
  }
});

InventoryItemSchema.set('toJSON', { virtuals: true });

export const InventoryItem =
  mongoose.models.InventoryItem || mongoose.model('InventoryItem', InventoryItemSchema);

export default InventoryItem;
