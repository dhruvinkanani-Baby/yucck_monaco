import mongoose, { Schema, type Document, type Model } from 'mongoose'
import type { TaskDefinition } from '@interncert/types'

export type ITask = TaskDefinition

export interface IInternship extends Document {
  title: string
  description: string
  tasks: ITask[]
  price: number
  currency: string
  is_active: boolean
  createdAt: Date
  updatedAt: Date
}

export const TaskSchema = new Schema<ITask>(
  {
    task_number: {
      type: Number,
      required: true,
      min: 1,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    deadline_days: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false },
)

const InternshipSchema = new Schema<IInternship>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    tasks: {
      type: [TaskSchema],
      required: true,
      validate: {
        validator: (v: ITask[]) => Array.isArray(v) && v.length > 0,
        message: 'An internship must contain at least one task.',
      },
    },
    price: {
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
      maxlength: 10,
      match: [/^[A-Z]{3,10}$/, 'Invalid currency code format'],
    },
    is_active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
)

export const Internship: Model<IInternship> =
  mongoose.models.Internship ||
  mongoose.model<IInternship>('Internship', InternshipSchema)
