import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import mongoose from 'mongoose'
import { Payment } from '../models/Payment.js'
import { Enrollment, type IEnrollment } from '../models/Enrollment.js'
import { Internship } from '../models/Internship.js'
import { Certificate } from '../models/Certificate.js'
import { razorpayService } from '../services/razorpay.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

const createOrderSchema = z.object({
  internship_id: z.string().min(1),
})

const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
})

export async function createEnrollmentOrder(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parseResult = createOrderSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { internship_id } = parseResult.data
    const userId = req.user?._id

    if (!userId) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    // Invariant check: user cannot double-enroll while an active enrollment exists
    const existingActive = await Enrollment.findOne({
      user_id: userId,
      internship_id,
      status: 'active',
    })

    if (existingActive) {
      res.status(409).json({
        error: 'active_enrollment_exists',
        message: 'You already have an active enrollment in this internship.',
      })
      return
    }

    const internship = await Internship.findById(internship_id)
    if (!internship || !internship.is_active) {
      res.status(404).json({ error: 'internship_not_found' })
      return
    }

    // Create Razorpay order
    const order = await razorpayService.createOrder({
      amount: internship.price,
      currency: internship.currency,
      receipt: `rcpt_${String(userId).slice(-8)}_${Date.now()}`,
      notes: {
        userId: String(userId),
        internshipId: String(internship._id),
      },
    })

    // Insert Payment record { status: "created", user_id: req.user._id, ... }
    try {
      await Payment.create({
        user_id: userId,
        internship_id: internship._id,
        razorpay_order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        status: 'created',
      })
    } catch (err: unknown) {
      // Catch unique index violation (code 11000) as 409 Conflict
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: number }).code === 11000
      ) {
        res.status(409).json({
          error: 'duplicate_order',
          message: 'An order with this ID already exists.',
        })
        return
      }
      throw err
    }

    res.status(201).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: env.RAZORPAY_KEY_ID,
    })
  } catch (err) {
    next(err)
  }
}

export async function verifyEnrollmentPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parseResult = verifyPaymentSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      parseResult.data
    const userId = req.user?._id

    if (!userId) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    // Step 1: Look up Payment by { razorpay_order_id, user_id: req.user.id }
    // 403 if not found (SEC-03: verifying payment using another user's order ID is rejected pre-mutation)
    const payment = await Payment.findOne({
      razorpay_order_id,
      user_id: userId,
    })

    if (!payment) {
      res.status(403).json({
        error: 'forbidden',
        message: 'Payment order does not belong to the authenticated user.',
      })
      return
    }

    // Step 2: If already paid, return existing enrollment (idempotent replay, SEC-04)
    if (payment.status === 'paid') {
      const existingEnrollment = await Enrollment.findOne({
        user_id: userId,
        internship_id: payment.internship_id,
        status: 'active',
      })

      res.status(200).json({
        status: 'already_paid',
        enrollment: existingEnrollment,
      })
      return
    }

    // Step 3: Verify Razorpay signature
    const isValidSignature = razorpayService.verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    })

    if (!isValidSignature) {
      res.status(400).json({
        error: 'invalid_signature',
        message: 'Cryptographic payment signature verification failed.',
      })
      return
    }

    // Step 4: Fetch payment from Razorpay API; compare amount, currency, status==="captured"
    const fetchedPayment =
      await razorpayService.fetchPayment(razorpay_payment_id)

    if (
      fetchedPayment.amount !== payment.amount ||
      fetchedPayment.currency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      // SEC-05: Valid signature, wrong amount -> Rejected
      res.status(400).json({
        error: 'payment_amount_mismatch',
        message: 'Payment amount or currency mismatch with server record.',
      })
      return
    }

    if (
      fetchedPayment.status !== 'captured' &&
      fetchedPayment.status !== 'authorized'
    ) {
      res.status(400).json({
        error: 'invalid_payment_status',
        message: `Payment status is ${fetchedPayment.status}, expected captured.`,
      })
      return
    }

    // Step 5: Mongo transaction: Payment.status="paid" + create Enrollment in one commit
    let enrollment: IEnrollment | null = null

    const executeCommit = async (session?: mongoose.ClientSession) => {
      payment.status = 'paid'
      payment.razorpay_payment_id = razorpay_payment_id
      payment.razorpay_signature = razorpay_signature
      await payment.save(session ? { session } : undefined)

      const internship = await Internship.findById(
        payment.internship_id,
      ).session(session || null)
      const totalDays =
        internship?.tasks.reduce((sum, t) => sum + t.deadline_days, 0) || 30
      const startDate = new Date()
      const endDate = new Date(
        startDate.getTime() + totalDays * 24 * 60 * 60 * 1000,
      )

      const [created] = await Enrollment.create(
        [
          {
            user_id: userId,
            internship_id: payment.internship_id,
            status: 'active',
            current_task: 1,
            start_date: startDate,
            end_date: endDate,
          },
        ],
        session ? { session } : undefined,
      )

      enrollment = created
    }

    // Execute within a transaction if replica set supports transactions
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        await executeCommit(session)
      })
    } catch (txnError: unknown) {
      // In standalone Mongo without replica set (e.g. in test envs), fallback gracefully
      const isStandalone =
        txnError instanceof Error &&
        (txnError.message.includes(
          'Transaction numbers are only allowed on a replica set',
        ) ||
          txnError.message.includes('standalone'))

      if (isStandalone) {
        logger.warn(
          'Replica set not available; executing payment commit non-transactionally',
        )
        await executeCommit()
      } else {
        throw txnError
      }
    } finally {
      await session.endSession()
    }

    res.status(200).json({
      status: 'success',
      enrollment,
    })
  } catch (err: unknown) {
    // If enrollment partial unique index violated (code 11000)
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: number }).code === 11000
    ) {
      res.status(409).json({
        error: 'active_enrollment_exists',
        message: 'An active enrollment already exists for this internship.',
      })
      return
    }
    next(err)
  }
}

export async function getMyEnrollments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?._id
    if (!userId) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    const enrollments = await Enrollment.find({ user_id: userId })
      .sort({ createdAt: -1 })
      .populate('internship_id')

    const enrollmentIds = enrollments.map((e) => e._id)
    const certificates = await Certificate.find({
      enrollment_id: { $in: enrollmentIds },
    })
    const certMap = new Map(
      certificates.map((c) => [c.enrollment_id.toString(), c]),
    )

    res.status(200).json({
      enrollments: enrollments.map((e) => {
        const cert = certMap.get(e._id.toString())
        const internship = e.internship_id as unknown as {
          _id: unknown
          title: string
          description: string
          tasks: unknown[]
          price: number
          currency: string
        }
        return {
          id: String(e._id),
          user_id: String(e.user_id),
          internship_id: String(internship?._id || e.internship_id),
          status: e.status,
          current_task: e.current_task,
          start_date: e.start_date.toISOString(),
          end_date: e.end_date.toISOString(),
          completed_at: e.completed_at?.toISOString() || null,
          created_at: e.createdAt.toISOString(),
          updated_at: e.updatedAt.toISOString(),
          internship: internship
            ? {
                id: String(internship._id),
                title: internship.title,
                description: internship.description,
                tasks: internship.tasks,
                price: internship.price,
                currency: internship.currency,
              }
            : undefined,
          certificate: cert
            ? {
                id: String(cert._id),
                enrollment_id: String(cert.enrollment_id),
                verification_code: cert.verification_code,
                pdf_url: cert.pdf_url,
                status: cert.status,
                issued_at: cert.issued_at.toISOString(),
              }
            : null,
        }
      }),
    })
  } catch (err) {
    next(err)
  }
}
