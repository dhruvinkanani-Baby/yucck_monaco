import mongoose, { Schema, type Document, type Model } from 'mongoose'
import type { EnrollmentStatus } from '@interncert/types'

export interface IEnrollment extends Document {
  user_id: mongoose.Types.ObjectId
  internship_id: mongoose.Types.ObjectId
  status: EnrollmentStatus
  current_task: number
  start_date: Date
  end_date: Date
  completed_at?: Date | null
  createdAt: Date
  updatedAt: Date
}

const EnrollmentSchema = new Schema<IEnrollment>(
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
    status: {
      type: String,
      enum: ['active', 'expired', 'closed'],
      default: 'active',
      required: true,
    },
    current_task: {
      type: Number,
      default: 1,
      min: 1,
      required: true,
    },
    start_date: {
      type: Date,
      default: Date.now,
      required: true,
    },
    end_date: {
      type: Date,
      required: true,
    },
    completed_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

// Invariant: Unique active enrollment per user per internship.
// A user cannot have two active enrollments for the same internship concurrently.
// Re-enrolling after previous enrollment became expired or closed is allowed.
EnrollmentSchema.index(
  { user_id: 1, internship_id: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'unique_active_user_internship',
  },
)

// Index for background expiration worker: flips Enrollment.status active -> expired past end_date
EnrollmentSchema.index(
  { status: 1, end_date: 1 },
  { name: 'idx_enrollment_status_end_date' },
)

export const Enrollment: Model<IEnrollment> =
  mongoose.models.Enrollment ||
  mongoose.model<IEnrollment>('Enrollment', EnrollmentSchema)
