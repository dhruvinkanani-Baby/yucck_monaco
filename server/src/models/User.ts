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
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address format'],
      index: true,
    },
    password_hash: {
      type: String,
      required: true,
      maxlength: 255,
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
      maxlength: 128,
      index: true,
    },
    reset_password_expires_at: {
      type: Date,
      default: null,
    },
    totp_secret: {
      type: String,
      default: null,
      maxlength: 128,
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
