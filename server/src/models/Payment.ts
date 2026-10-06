import mongoose, { Schema, type Document, type Model } from 'mongoose'
import type { PaymentStatus } from '@interncert/types'

export interface IPayment extends Document {
  user_id: mongoose.Types.ObjectId
  internship_id: mongoose.Types.ObjectId
  razorpay_order_id: string
  razorpay_payment_id?: string | null
  razorpay_signature?: string | null
  amount: number
  currency: string
  status: PaymentStatus
  createdAt: Date
  updatedAt: Date
}

const PaymentSchema = new Schema<IPayment>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    internship_id: {
      type: Schema.Types.ObjectId,
      ref: 'Internship',
      required: true,
      index: true,
    },
    razorpay_order_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    razorpay_payment_id: {
      type: String,
      default: null,
      trim: true,
      index: true,
      sparse: true,
    },
    razorpay_signature: {
      type: String,
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      default: 'INR',
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'created',
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
)

// Invariant: Unique index on razorpay_order_id prevents duplicate order creation / replays
PaymentSchema.index(
  { razorpay_order_id: 1 },
  { unique: true, name: 'unique_razorpay_order_id' },
)

// Index for nightly reconciliation queries (status created older than N minutes)
PaymentSchema.index(
  { status: 1, createdAt: 1 },
  { name: 'idx_payment_status_created_at' },
)

export const Payment: Model<IPayment> =
  mongoose.models.Payment || mongoose.model<IPayment>('Payment', PaymentSchema)
