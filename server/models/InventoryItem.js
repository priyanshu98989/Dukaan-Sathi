/**
 * Every user-facing string in the app lives here.
 *
 * Rule: the shopkeeper must never see a stack trace, an HTTP status code or an
 * English technical message. Anything that reaches the screen comes from this file.
 */

import mongoose from 'mongoose';

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

InventoryItemSchema.set('toJSON', { virtuals: true });

export const InventoryItem =
  mongoose.models.InventoryItem || mongoose.model('InventoryItem', InventoryItemSchema);

export default InventoryItem;
