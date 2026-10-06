import { Queue, Worker, type Job } from 'bullmq'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { Payment } from '../models/Payment.js'
import { Enrollment } from '../models/Enrollment.js'
import { Internship } from '../models/Internship.js'
import { razorpayService } from '../services/razorpay.js'

export const RECONCILIATION_QUEUE_NAME = 'payment-reconciliation'

export interface ReconciliationJobData {
  olderThanMinutes?: number
}

// Connection configuration for BullMQ
const connection = {
  url: env.REDIS_URL,
}

export const reconciliationQueue = new Queue<ReconciliationJobData>(
  RECONCILIATION_QUEUE_NAME,
  {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  },
)

/**
 * Reconciles local created payments with Razorpay records.
 */
export async function reconcileStaleCreatedPayments(
  olderThanMinutes = 30,
): Promise<{ checked: number; reconciled: number; failed: number }> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000)

  logger.info({ cutoff }, 'Starting payment reconciliation scan...')

  const stalePayments = await Payment.find({
    status: 'created',
    createdAt: { $lt: cutoff },
  })

  let reconciled = 0
  let failed = 0

  for (const payment of stalePayments) {
    try {
      const order = await razorpayService.fetchOrder(payment.razorpay_order_id)

      if (order.status === 'paid') {
        payment.status = 'paid'
        await payment.save()

        const existingEnrollment = await Enrollment.findOne({
          user_id: payment.user_id,
          internship_id: payment.internship_id,
          status: 'active',
        })

        if (!existingEnrollment) {
          const internship = await Internship.findById(payment.internship_id)
          const totalDays =
            internship?.tasks.reduce((sum, t) => sum + t.deadline_days, 0) || 30
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
        }

        reconciled++
        logger.info(
          { orderId: payment.razorpay_order_id },
          'Reconciled captured payment from Razorpay',
        )
      } else if (order.status === 'attempted' || order.status === 'created') {
        // Order remains unpaid beyond window; keep or mark failed if expired
        const orderAgeHours =
          (Date.now() - payment.createdAt.getTime()) / (1000 * 60 * 60)
        if (orderAgeHours > 24) {
          payment.status = 'failed'
          await payment.save()
          failed++
        }
      }
    } catch (err) {
      logger.error(
        { err, orderId: payment.razorpay_order_id },
        'Failed to reconcile individual payment',
      )
    }
  }

  logger.info(
    { checked: stalePayments.length, reconciled, failed },
    'Payment reconciliation scan complete',
  )

  return { checked: stalePayments.length, reconciled, failed }
}

/**
 * Worker processor for reconciliation jobs.
 */
export function createReconciliationWorker(): Worker<ReconciliationJobData> {
  const worker = new Worker<ReconciliationJobData>(
    RECONCILIATION_QUEUE_NAME,
    async (job: Job<ReconciliationJobData>) => {
      const olderThan = job.data.olderThanMinutes ?? 30
      return await reconcileStaleCreatedPayments(olderThan)
    },
    { connection },
  )

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Payment reconciliation job completed')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Payment reconciliation job failed')
  })

  return worker
}

/**
 * Schedules nightly repeatable reconciliation job.
 */
export async function scheduleNightlyReconciliation(): Promise<void> {
  // Cron schedule: Nightly at 2:00 AM (0 2 * * *)
  await reconciliationQueue.upsertJobScheduler(
    'nightly-payment-reconciliation',
    {
      pattern: '0 2 * * *',
    },
    {
      name: 'nightly-reconcile',
      data: { olderThanMinutes: 30 },
    },
  )
  logger.info('Scheduled nightly payment reconciliation job (0 2 * * *)')
}
