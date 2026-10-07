import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { TaskSubmission } from '../models/TaskSubmission.js'
import { Enrollment } from '../models/Enrollment.js'
import { Internship } from '../models/Internship.js'
import { Certificate } from '../models/Certificate.js'
import { Payment } from '../models/Payment.js'
import { User } from '../models/User.js'
import { AuditLog } from '../models/AuditLog.js'
import { enqueueCertificateIssuance } from '../workers/certificateWorker.js'
import { generateMfaSecret, verifyMfaToken } from '../middleware/mfa.js'
import { razorpayService } from '../services/razorpay.js'
import { escapeRegex } from '../utils/regex.js'

// Strict DTO schemas rejecting unknown keys
const reviewSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    feedback: z.string().trim().max(2000).optional(),
  })
  .strict()

const verifyMfaSchema = z
  .object({
    totp_code: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  })
  .strict()

const revokeCertificateSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    totp_code: z
      .string()
      .trim()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict()

const refundPaymentSchema = z
  .object({
    amount: z.number().positive().optional(),
    reason: z.string().trim().max(500).optional(),
    totp_code: z
      .string()
      .trim()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict()

export async function reviewSubmission(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params
    const parseResult = reviewSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { decision, feedback } = parseResult.data
    const adminId = req.user?._id

    if (!adminId) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    // Step 1: Initial submission lookup to resolve parent enrollment
    const existingSub = await TaskSubmission.findById(id)
    if (!existingSub) {
      res.status(404).json({ error: 'submission_not_found' })
      return
    }

    const enrollment = await Enrollment.findById(existingSub.enrollment_id)
    if (!enrollment) {
      res.status(404).json({ error: 'enrollment_not_found' })
      return
    }

    // Step 2: Atomic findOneAndUpdate with status "pending" and task_number === enrollment.current_task
    // Invariant SEC-12: Approving stale/old task twice or after concurrent change yields 409
    const sub = await TaskSubmission.findOneAndUpdate(
      {
        _id: id,
        status: 'pending',
        task_number: enrollment.current_task,
      },
      {
        status: decision,
        reviewed_by: adminId,
        reviewed_at: new Date(),
        feedback: feedback || null,
      },
      { new: true },
    )

    if (!sub) {
      res.status(409).json({
        error: 'stale_review',
        message:
          'This submission is no longer pending or does not match the active task.',
      })
      return
    }

    // Step 3: On approval, increment enrollment.current_task (never decrement/overwrite)
    let nextTaskNumber = enrollment.current_task
    if (decision === 'approved') {
      nextTaskNumber = enrollment.current_task + 1
      await Enrollment.findByIdAndUpdate(
        enrollment._id,
        { $inc: { current_task: 1 } },
        { new: true },
      )

      // Check if all tasks in internship have been finished
      const internship = await Internship.findById(enrollment.internship_id)
      const totalTasks = internship?.tasks.length || 0

      if (totalTasks > 0 && nextTaskNumber > totalTasks) {
        await Enrollment.findByIdAndUpdate(enrollment._id, {
          completed_at: new Date(),
        })
        try {
          await enqueueCertificateIssuance(String(enrollment._id))
        } catch {
          // Redis queue failure does not block review response
        }
      }
    }

    // Step 4: Write AuditLog entry (append-only)
    const reqId =
      (req.id as string) || (res.getHeader('x-request-id') as string) || null

    await AuditLog.create({
      admin_id: adminId,
      action: 'REVIEW_SUBMISSION',
      target_type: 'TaskSubmission',
      target_id: String(sub._id),
      before: {
        status: 'pending',
        current_task: enrollment.current_task,
      },
      after: {
        status: decision,
        current_task: nextTaskNumber,
        feedback: feedback || null,
      },
      ip: req.ip || null,
      request_id: reqId,
    })

    res.status(200).json({
      status: 'success',
      decision,
      submission: {
        id: String(sub._id),
        status: sub.status,
        task_number: sub.task_number,
        reviewed_at: sub.reviewed_at?.toISOString(),
        feedback: sub.feedback,
      },
      next_task: nextTaskNumber,
    })
  } catch (err) {
    next(err)
  }
}

export async function getPendingSubmissions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawLimit = Number(req.query.limit) || 20
    const limit = Math.min(Math.max(1, rawLimit), 100) // Clamped server-side max 100
    const skip = Math.max(0, Number(req.query.skip) || 0)

    const pendingList = await TaskSubmission.find({ status: 'pending' })
      .sort({ submitted_at: 1 })
      .skip(skip)
      .limit(limit)
      .populate('enrollment_id')

    res.status(200).json({
      limit,
      skip,
      submissions: pendingList.map((s) => ({
        id: String(s._id),
        enrollment_id: String(s.enrollment_id),
        task_number: s.task_number,
        status: s.status,
        content: s.content,
        submitted_at: s.submitted_at.toISOString(),
      })),
    })
  } catch (err) {
    next(err)
  }
}

export async function issueCertificateForEnrollment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params
    const enrollment = await Enrollment.findById(id)
    if (!enrollment) {
      res.status(404).json({ error: 'enrollment_not_found' })
      return
    }

    if (!enrollment.completed_at) {
      res.status(400).json({
        error: 'enrollment_not_completed',
        message:
          'Cannot issue certificate before all milestones are completed.',
      })
      return
    }

    await enqueueCertificateIssuance(String(enrollment._id))

    res.status(202).json({
      status: 'queued',
      message: 'Certificate issuance job enqueued successfully.',
      enrollment_id: String(enrollment._id),
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Step 8: MFA Enrollment Initiation
 */
export async function setupMfa(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const { secret, uri, qrCode } = await generateMfaSecret(user.email)

    // Save secret provisionally until user verifies with a live code
    await User.findByIdAndUpdate(user._id, {
      totp_secret: secret,
      totp_enabled: false,
    })

    res.status(200).json({
      secret,
      uri,
      qr_code: qrCode,
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Step 8: MFA Verification & Activation
 */
export async function verifyMfa(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const parseResult = verifyMfaSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { totp_code } = parseResult.data

    if (!user.totp_secret) {
      res.status(400).json({
        error: 'mfa_not_initiated',
        message: 'Must initiate MFA setup before verification.',
      })
      return
    }

    const isValid = verifyMfaToken(user.totp_secret, totp_code)
    if (!isValid) {
      res.status(400).json({
        error: 'invalid_code',
        message: 'Invalid TOTP code.',
      })
      return
    }

    await User.findByIdAndUpdate(user._id, {
      totp_enabled: true,
    })

    const reqId =
      (req.id as string) || (res.getHeader('x-request-id') as string) || null

    await AuditLog.create({
      admin_id: user._id,
      action: 'ENABLE_MFA',
      target_type: 'User',
      target_id: String(user._id),
      before: { totp_enabled: false },
      after: { totp_enabled: true },
      ip: req.ip || null,
      request_id: reqId,
    })

    res.status(200).json({
      status: 'success',
      message: 'MFA enabled successfully.',
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Step 8 / SEC-15: Certificate Revocation with MFA Step-Up Protection
 */
export async function revokeCertificate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parseResult = revokeCertificateSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { reason } = parseResult.data
    const adminId = req.user?._id

    // Lookup by ID or verification code
    const rawId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id
    const idStr = typeof rawId === 'string' ? rawId : ''
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(idStr)

    const cert = await Certificate.findOne({
      $or: [{ _id: isObjectId ? idStr : null }, { verification_code: idStr }],
    })

    if (!cert) {
      res.status(404).json({ error: 'certificate_not_found' })
      return
    }

    if (cert.status === 'revoked') {
      res.status(409).json({
        error: 'already_revoked',
        message: 'Certificate is already revoked.',
        revoked_at: cert.revoked_at?.toISOString(),
      })
      return
    }

    const beforeStatus = cert.status
    cert.status = 'revoked'
    cert.revoked_at = new Date()
    cert.revoked_reason = reason
    cert.revoked_by = adminId
    await cert.save()

    // Write immutable AuditLog entry (SEC-15)
    const reqId =
      (req.id as string) || (res.getHeader('x-request-id') as string) || null

    await AuditLog.create({
      admin_id: adminId,
      action: 'REVOKE_CERTIFICATE',
      target_type: 'Certificate',
      target_id: String(cert._id),
      before: { status: beforeStatus },
      after: {
        status: 'revoked',
        revoked_reason: reason,
        revoked_at: cert.revoked_at,
      },
      ip: req.ip || null,
      request_id: reqId,
    })

    res.status(200).json({
      status: 'success',
      certificate: {
        id: String(cert._id),
        verification_code: cert.verification_code,
        status: cert.status,
        revoked_at: cert.revoked_at.toISOString(),
        revoked_reason: cert.revoked_reason,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Step 8: Payment Refund with MFA Step-Up Protection
 */
export async function refundPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params
    const parseResult = refundPaymentSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { amount, reason } = parseResult.data
    const adminId = req.user?._id

    const payment = await Payment.findById(id)
    if (!payment) {
      res.status(404).json({ error: 'payment_not_found' })
      return
    }

    if (payment.status !== 'paid') {
      res.status(400).json({
        error: 'payment_not_refundable',
        message: `Cannot refund payment in '${payment.status}' state.`,
      })
      return
    }

    if (!payment.razorpay_payment_id) {
      res.status(400).json({
        error: 'missing_razorpay_payment_id',
        message: 'Payment has no associated Razorpay capture ID.',
      })
      return
    }

    // Call Razorpay API to process refund
    await razorpayService.refundPayment(payment.razorpay_payment_id, amount)

    const beforeStatus = payment.status
    const isPartial = amount && amount < payment.amount
    payment.status = isPartial ? 'partially_refunded' : 'refunded'
    await payment.save()

    // Write immutable AuditLog entry
    const reqId =
      (req.id as string) || (res.getHeader('x-request-id') as string) || null

    await AuditLog.create({
      admin_id: adminId,
      action: 'REFUND_PAYMENT',
      target_type: 'Payment',
      target_id: String(payment._id),
      before: { status: beforeStatus },
      after: {
        status: payment.status,
        refunded_amount: amount || payment.amount,
        reason: reason || null,
      },
      ip: req.ip || null,
      request_id: reqId,
    })

    res.status(200).json({
      status: 'success',
      payment: {
        id: String(payment._id),
        status: payment.status,
        amount: payment.amount,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Step 8: Paginated Audit Log Viewer
 */
export async function getAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawLimit = Number(req.query.limit) || 50
    const limit = Math.min(Math.max(1, rawLimit), 100) // Clamped server-side max 100
    const skip = Math.max(0, Number(req.query.skip) || 0)
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''

    const filter: Record<string, unknown> = {}
    if (q) {
      const escaped = escapeRegex(q)
      filter.$or = [
        { action: { $regex: escaped, $options: 'i' } },
        { target_type: { $regex: escaped, $options: 'i' } },
      ]
    }

    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('admin_id', 'email role')

    res.status(200).json({
      limit,
      skip,
      logs: logs.map((l) => ({
        id: String(l._id),
        admin_id: String(l.admin_id),
        action: l.action,
        target_type: l.target_type,
        target_id: l.target_id,
        before: l.before,
        after: l.after,
        ip: l.ip,
        request_id: l.request_id,
        created_at: l.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Step 8: Paginated Certificates Listing
 */
export async function getCertificates(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawLimit = Number(req.query.limit) || 50
    const limit = Math.min(Math.max(1, rawLimit), 100) // Clamped max 100
    const skip = Math.max(0, Number(req.query.skip) || 0)
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : ''

    const filter: Record<string, unknown> = {}
    if (code) {
      const escaped = escapeRegex(code)
      filter.verification_code = { $regex: escaped, $options: 'i' }
    }

    const certs = await Certificate.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('enrollment_id')

    res.status(200).json({
      limit,
      skip,
      certificates: certs.map((c) => ({
        id: String(c._id),
        enrollment_id: String(c.enrollment_id),
        verification_code: c.verification_code,
        status: c.status,
        issued_at: c.issued_at.toISOString(),
        revoked_at: c.revoked_at?.toISOString() || null,
        revoked_reason: c.revoked_reason || null,
      })),
    })
  } catch (err) {
    next(err)
  }
}
