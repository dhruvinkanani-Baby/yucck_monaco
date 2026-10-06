import mongoose, { Schema, type Document, type Model } from 'mongoose'

export interface ICertificate extends Document {
  enrollment_id: mongoose.Types.ObjectId
  verification_code: string
  pdf_url: string
  status: 'valid' | 'revoked'
  issued_at: Date
  revoked_at?: Date | null
  revoked_reason?: string | null
  revoked_by?: mongoose.Types.ObjectId | null
  createdAt: Date
  updatedAt: Date
}

const CertificateSchema = new Schema<ICertificate>(
  {
    enrollment_id: {
      type: Schema.Types.ObjectId,
      ref: 'Enrollment',
      required: true,
      unique: true,
    },
    verification_code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    pdf_url: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['valid', 'revoked'],
      default: 'valid',
      required: true,
      index: true,
    },
    issued_at: {
      type: Date,
      default: Date.now,
      required: true,
    },
    revoked_at: {
      type: Date,
      default: null,
    },
    revoked_reason: {
      type: String,
      trim: true,
      default: null,
    },
    revoked_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

// Invariant: 1 Certificate per enrollment max (duplicate-key on retry is a no-op success)
CertificateSchema.index(
  { enrollment_id: 1 },
  { unique: true, name: 'unique_enrollment_certificate' },
)

// Invariant: Verification code must be globally unique and fast to look up by code
CertificateSchema.index(
  { verification_code: 1 },
  { unique: true, name: 'unique_certificate_verification_code' },
)

export const Certificate: Model<ICertificate> =
  mongoose.models.Certificate ||
  mongoose.model<ICertificate>('Certificate', CertificateSchema)
