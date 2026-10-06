import mongoose, { Schema, type Document, type Model } from 'mongoose'
import type { UserRole } from '@interncert/types'

export interface IUser extends Document {
  email: string
  password_hash: string
  role: UserRole
  session_version: number
  reset_password_token_hash?: string | null
  reset_password_expires_at?: Date | null
  totp_secret?: string | null
  totp_enabled?: boolean
  createdAt: Date
  updatedAt: Date
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password_hash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['student', 'admin'],
      default: 'student',
      required: true,
    },
    session_version: {
      type: Number,
      default: 1,
      required: true,
    },
    reset_password_token_hash: {
      type: String,
      default: null,
      index: true,
    },
    reset_password_expires_at: {
      type: Date,
      default: null,
    },
    totp_secret: {
      type: String,
      default: null,
    },
    totp_enabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
)

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>('User', UserSchema)
