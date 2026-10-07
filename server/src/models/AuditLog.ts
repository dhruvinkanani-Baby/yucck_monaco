import mongoose, { Schema, type Document, type Model } from 'mongoose'

export interface IAuditLog extends Document {
  admin_id: mongoose.Types.ObjectId
  action: string
  target_type: string
  target_id: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ip?: string | null
  request_id?: string | null
  createdAt: Date
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    admin_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      index: true,
    },
    target_type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
      index: true,
    },
    target_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      index: true,
    },
    before: {
      type: Schema.Types.Mixed,
      default: null,
    },
    after: {
      type: Schema.Types.Mixed,
      default: null,
    },
    ip: {
      type: String,
      trim: true,
      maxlength: 45,
      default: null,
    },
    request_id: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
      index: true,
    },
  },
  {
    // Append-only: createdAt only, no updatedAt
    timestamps: { createdAt: true, updatedAt: false },
  },
)

// Invariant: AuditLog is append-only.
// Prevent modifications or deletions at Mongoose middleware level.
const disallowMutation = () => {
  throw new Error(
    'AuditLog is append-only: update and delete operations are prohibited.',
  )
}

AuditLogSchema.pre('updateOne', disallowMutation)
AuditLogSchema.pre('updateMany', disallowMutation)
AuditLogSchema.pre('findOneAndUpdate', disallowMutation)
AuditLogSchema.pre('deleteOne', disallowMutation)
AuditLogSchema.pre('deleteMany', disallowMutation)
AuditLogSchema.pre('findOneAndDelete', disallowMutation)

// Query index for auditing specific entity histories
AuditLogSchema.index(
  { target_type: 1, target_id: 1, createdAt: -1 },
  { name: 'idx_audit_target_history' },
)

export const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog ||
  mongoose.model<IAuditLog>('AuditLog', AuditLogSchema)
