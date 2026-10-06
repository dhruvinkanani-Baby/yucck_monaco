import { Queue, Worker, type Job } from 'bullmq'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { Enrollment } from '../models/Enrollment.js'

export const EXPIRATION_QUEUE_NAME = 'enrollment-expiration'

export interface ExpirationJobData {
  triggeredBy?: string
}

const connection = {
  url: env.REDIS_URL,
}

export const enrollmentExpirationQueue = new Queue<ExpirationJobData>(
  EXPIRATION_QUEUE_NAME,
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
 * Finds all active enrollments past end_date and flips status to 'expired'.
 */
export async function expirePastDueEnrollments(): Promise<{
  expiredCount: number
}> {
  const now = new Date()
  logger.info({ now }, 'Running scheduled check for expired enrollments...')

  const result = await Enrollment.updateMany(
    {
      status: 'active',
      end_date: { $lt: now },
    },
    {
      $set: { status: 'expired' },
    },
  )

  const expiredCount = result.modifiedCount ?? 0
  logger.info(
    { expiredCount },
    `Flipped ${expiredCount} past-due enrollments from active to expired.`,
  )

  return { expiredCount }
}

/**
 * Creates BullMQ worker for enrollment expiration tasks.
 */
export function createEnrollmentExpirationWorker(): Worker<ExpirationJobData> {
  const worker = new Worker<ExpirationJobData>(
    EXPIRATION_QUEUE_NAME,
    async (_job: Job<ExpirationJobData>) => {
      return await expirePastDueEnrollments()
    },
    { connection },
  )

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id },
      'Enrollment expiration job finished successfully',
    )
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Enrollment expiration job failed')
  })

  return worker
}

/**
 * Schedules repeatable hourly check to expire enrollments.
 */
export async function scheduleEnrollmentExpirationJob(): Promise<void> {
  // Cron schedule: Every hour at minute 0 (0 * * * *)
  await enrollmentExpirationQueue.upsertJobScheduler(
    'hourly-enrollment-expiration',
    {
      pattern: '0 * * * *',
    },
    {
      name: 'hourly-expiration-check',
      data: { triggeredBy: 'cron' },
    },
  )
  logger.info('Scheduled repeatable enrollment expiration job (0 * * * *)')
}
