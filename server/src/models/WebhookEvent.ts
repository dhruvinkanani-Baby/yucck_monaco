import mongoose, { Schema, type Document, type Model } from 'mongoose'

export interface IWebhookEvent extends Document {
  event_id: string
  event: string
  payload: Record<string, unknown>
  processed_at: Date
}

const WebhookEventSchema = new Schema<IWebhookEvent>(
  {
    event_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
    event: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    processed_at: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24 * 30, // 30-day retention
    },
  },
  {
    timestamps: false,
  },
)

WebhookEventSchema.index(
  { event_id: 1 },
  { unique: true, name: 'unique_webhook_event_id' },
)

export const WebhookEvent: Model<IWebhookEvent> =
  mongoose.models.WebhookEvent ||
  mongoose.model<IWebhookEvent>('WebhookEvent', WebhookEventSchema)
