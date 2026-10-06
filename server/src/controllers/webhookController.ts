import type { Request, Response, NextFunction } from 'express'
import { Payment } from '../models/Payment.js'
import { Enrollment } from '../models/Enrollment.js'
import { Internship } from '../models/Internship.js'
import { WebhookEvent } from '../models/WebhookEvent.js'
import { razorpayService } from '../services/razorpay.js'
import { redis } from '../config/redis.js'
import { logger } from '../config/logger.js'
import { env } from '../config/env.js'

export async function handleRazorpayWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const signature = req.headers['x-razorpay-signature']
    if (typeof signature !== 'string' || !signature) {
      res.status(400).json({ error: 'missing_webhook_signature' })
      return
    }

    const rawBody = req.body as Buffer
    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ error: 'invalid_raw_body' })
      return
    }

    // 1. Verify signature against raw body
    const isValid = razorpayService.verifyWebhookSignature(rawBody, signature)
    if (!isValid) {
      logger.warn('Razorpay webhook signature verification failed')
      res.status(400).json({ error: 'invalid_webhook_signature' })
      return
    }

    // 2. Parse payload
    interface RazorpayWebhookPayload {
      event_id?: string
      id?: string
      event?: string
      payload?: {
        payment?: {
          entity?: {
            id?: string
            order_id?: string
            amount?: number
            currency?: string
            status?: string
          }
        }
        order?: {
          entity?: {
            id?: string
          }
        }
      }
    }

    let payload: RazorpayWebhookPayload
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookPayload
    } catch {
      res.status(400).json({ error: 'malformed_json_body' })
      return
    }

    const eventId =
      String(payload.event_id || payload.id || '') ||
      `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const eventName = String(payload.event || '')

    // 3. Deduplication via Redis NX (when available) + WebhookEvent collection
    if (env.NODE_ENV !== 'test') {
      try {
        const lockKey = `webhook_dedupe:${eventId}`
        const acquired = await redis.set(lockKey, '1', 'EX', 86400, 'NX')

        if (!acquired) {
          logger.info(
            { eventId },
            'Webhook event skipped (duplicate detected in Redis)',
          )
          res.status(200).json({ status: 'already_processed', eventId })
          return
        }
      } catch (redisErr) {
        logger.warn(
          { err: redisErr },
          'Redis dedupe check unavailable; using DB deduplication',
        )
      }
    }

    try {
      await WebhookEvent.create({
        event_id: eventId,
        event: eventName,
        payload,
      })
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: number }).code === 11000
      ) {
        logger.info({ eventId }, 'Webhook event skipped (duplicate in MongoDB)')
        res.status(200).json({ status: 'already_processed', eventId })
        return
      }
      throw err
    }

    // 4. Apply state machine transitions to Payment
    const paymentEntity = payload.payload?.payment?.entity
    const orderEntity = payload.payload?.order?.entity
    const orderId = String(paymentEntity?.order_id || orderEntity?.id || '')
    const paymentId = String(paymentEntity?.id || '')

    logger.info(
      { eventName, eventId, orderId },
      'Processing Razorpay webhook event',
    )

    if (orderId) {
      const payment = await Payment.findOne({ razorpay_order_id: orderId })

      if (payment) {
        switch (eventName) {
          case 'payment.captured':
          case 'order.paid': {
            if (payment.status !== 'paid') {
              payment.status = 'paid'
              if (paymentId) {
                payment.razorpay_payment_id = paymentId
              }
              await payment.save()

              // Reconcile enrollment: If browser was closed after payment capture (SEC-06),
              // the webhook ensures the active enrollment is created.
              const existingEnrollment = await Enrollment.findOne({
                user_id: payment.user_id,
                internship_id: payment.internship_id,
                status: 'active',
              })

              if (!existingEnrollment) {
                const internship = await Internship.findById(
                  payment.internship_id,
                )
                const totalDays =
                  internship?.tasks.reduce(
                    (sum, t) => sum + t.deadline_days,
                    0,
                  ) || 30
                const startDate = new Date()
                const endDate = new Date(
                  startDate.getTime() + totalDays * 24 * 60 * 60 * 1000,
                )

                await Enrollment.create({
                  user_id: payment.user_id,
                  internship_id: payment.internship_id,
                  status: 'active',
                  current_task: 1,
                  start_date: startDate,
                  end_date: endDate,
                })
                logger.info(
                  { orderId, userId: payment.user_id },
                  'Created enrollment via webhook reconciliation (SEC-06)',
                )
              }
            }
            break
          }

          case 'payment.failed': {
            if (payment.status === 'created') {
              payment.status = 'failed'
              await payment.save()
            }
            break
          }

          case 'refund.processed':
          case 'refund.created': {
            payment.status = 'refunded'
            await payment.save()
            break
          }

          case 'payment.dispute.created': {
            logger.warn({ orderId, paymentId }, 'Payment dispute created')
            break
          }

          default:
            logger.info({ eventName }, 'Unhandled webhook event type')
        }
      }
    }

    res.status(200).json({ status: 'processed', eventId })
  } catch (err) {
    next(err)
  }
}
