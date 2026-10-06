import mongoose, { Schema, type Document, type Model } from 'mongoose'
import type { TaskSubmissionStatus } from '@interncert/types'

export interface ITaskSubmission extends Document {
  enrollment_id: mongoose.Types.ObjectId
  task_number: number
  status: TaskSubmissionStatus
  content: string
  submitted_at: Date
  reviewed_by?: mongoose.Types.ObjectId | null
  reviewed_at?: Date | null
  feedback?: string | null
  createdAt: Date
  updatedAt: Date
}

const TaskSubmissionSchema = new Schema<ITaskSubmission>(
  {
    enrollment_id: {
      type: Schema.Types.ObjectId,
      ref: 'Enrollment',
      required: true,
      index: true,
    },
    task_number: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 10000,
    },
    submitted_at: {
      type: Date,
      default: Date.now,
      required: true,
    },
    reviewed_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewed_at: {
      type: Date,
      default: null,
    },
    feedback: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

// Compound index for enrollment submissions lookups
TaskSubmissionSchema.index(
  { enrollment_id: 1, task_number: 1 },
  { name: 'idx_submission_enrollment_task' },
)

// Index for review queue (status pending)
TaskSubmissionSchema.index(
  { status: 1, submitted_at: 1 },
  { name: 'idx_submission_status_submitted_at' },
)

export const TaskSubmission: Model<ITaskSubmission> =
  mongoose.models.TaskSubmission ||
  mongoose.model<ITaskSubmission>('TaskSubmission', TaskSubmissionSchema)
