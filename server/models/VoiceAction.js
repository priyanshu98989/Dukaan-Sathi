/**
 * Audit trail of every voice command the shopkeeper has made.
 * Powers the "Voice activity log" on the dashboard.
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const VoiceActionSchema = new Schema(
  {
    // Raw speech as understood by Gemini (Roman-script Hinglish, not translated).
    transcript: {
      type: String,
      required: [true, 'Transcript is required'],
      trim: true,
      maxlength: [500, 'Transcript is too long'],
    },
    // Only the three supported intents are ever stored.
    intent: {
      type: String,
      required: [true, 'Intent is required'],
      enum: {
        values: ['SALE', 'SET_STOCK', 'CHECK_STOCK', 'UNKNOWN'],
        message: 'Intent must be one of: SALE, SET_STOCK, CHECK_STOCK, UNKNOWN',
      },
      default: 'UNKNOWN',
    },
    // Exactly the AI output contract, after server-side validation.
    parsedData: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    // Did this action actually change (or successfully read) inventory?
    success: {
      type: Boolean,
      required: true,
      default: false,
    },
    // Human readable reason shown in the log, e.g. "Inventory updated".
    message: {
      type: String,
      trim: true,
      maxlength: [300, 'Message is too long'],
      default: '',
    },
    // Did this action leave the item below its low stock threshold?
    lowStock: {
      type: Boolean,
      default: false,
    },
    // Why it failed, when it failed. Internal only, never shown verbatim.
    failureCode: {
      type: String,
      trim: true,
      maxlength: [40, 'Failure code is too long'],
      default: '',
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

VoiceActionSchema.index({ createdAt: -1 });

export const VoiceAction =
  mongoose.models.VoiceAction || mongoose.model('VoiceAction', VoiceActionSchema);

export default VoiceAction;
