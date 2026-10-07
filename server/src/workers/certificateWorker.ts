import crypto from 'node:crypto'
import { Queue, Worker, type Job } from 'bullmq'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { Enrollment } from '../models/Enrollment.js'
import { Certificate, type ICertificate } from '../models/Certificate.js'
import { User } from '../models/User.js'
import { Internship } from '../models/Internship.js'
import { certificateService } from '../services/certificateService.js'
import { emailService } from '../services/email.js'

export const CERTIFICATE_QUEUE_NAME = 'certificate-issuance'

export interface CertificateJobData {
  enrollment_id: string
}

const connection = {
  url: env.REDIS_URL,
}

export const certificateQueue = new Queue<CertificateJobData>(
  CERTIFICATE_QUEUE_NAME,
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
 * Enqueues certificate issuance job with enrollment_id as jobId for deduplication
 */
export async function enqueueCertificateIssuance(
  enrollment_id: string,
): Promise<void> {
  if (env.NODE_ENV === 'test') {
    logger.info({ enrollment_id }, '[Test] Mock certificate issuance enqueued')
    return
  }

  await certificateQueue.add(
    'issue-certificate',
    { enrollment_id },
    {
      jobId: enrollment_id, // Deduplicate concurrent/repeated enqueues
    },
  )
  logger.info({ enrollment_id }, 'Enqueued certificate issuance job')
}

/**
 * Core certificate processing logic (SEC-13 idempotent execution)
 */
export async function processCertificateIssuance(
  enrollment_id: string,
): Promise<{ status: string; certificate: ICertificate }> {
  // 1. Check if Certificate already exists for this enrollment (idempotent early return)
  const existingCert = await Certificate.findOne({ enrollment_id })
  if (existingCert) {
    logger.info(
      { enrollment_id, code: existingCert.verification_code },
      'Certificate already exists for enrollment. Skipping generation (SEC-13 idempotent).',
    )
    return { status: 'already_issued', certificate: existingCert }
  }

  // 2. Fetch Enrollment
  const enrollment = await Enrollment.findById(enrollment_id)
  if (!enrollment) {
    throw new Error(`Enrollment ${enrollment_id} not found`)
  }

  // 3. Fetch User and Internship details
  const user = await User.findById(enrollment.user_id)
  if (!user) {
    throw new Error(`User ${enrollment.user_id} not found`)
  }

  const internship = await Internship.findById(enrollment.internship_id)
  if (!internship) {
    throw new Error(`Internship ${enrollment.internship_id} not found`)
  }

  // 4. Generate random opaque verification code as per spec (crypto.randomUUID)
  const verificationCode = crypto.randomUUID()
  const issuedAt = new Date()

  // Derive human-readable student display name from email
  const studentName = user.email
    .split('@')[0]
    .replace(/[._-]/g, ' ')
    .toUpperCase()

  // 5. Render and save PDF certificate
  const { pdfUrl } = await certificateService.saveCertificatePdf({
    verificationCode,
    studentName,
    internshipTitle: internship.title,
    startDate: enrollment.start_date,
    endDate: enrollment.end_date,
    issuedAt,
  })

  // 6. Atomic insert: duplicate-key on retry is a success no-op (SEC-13)
  let cert: ICertificate
  try {
    cert = await Certificate.create({
      enrollment_id: enrollment._id,
      verification_code: verificationCode,
      pdf_url: pdfUrl,
      issued_at: issuedAt,
    })

    // 7. Send notification email only once on successful creation
    await emailService.sendCertificateIssuedEmail({
      to: user.email,
      studentName,
      internshipTitle: internship.title,
      verificationCode,
      pdfUrl,
    })

    logger.info(
      { enrollment_id, verificationCode },
      'Certificate issued and email dispatched successfully',
    )
  } catch (err: unknown) {
    // Mongo duplicate key error code 11000
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: number }).code === 11000
    ) {
      logger.warn(
        { enrollment_id },
        'Duplicate key detected on Certificate insert. Recovering existing certificate (SEC-13).',
      )
      const found = await Certificate.findOne({ enrollment_id })
      if (!found) {
        throw err
      }
      return { status: 'already_issued', certificate: found }
    }
    throw err
  }

  return { status: 'issued', certificate: cert }
}

/**
 * Creates BullMQ worker for Certificate issuance jobs
 */
export function createCertificateWorker(): Worker<CertificateJobData> {
  const worker = new Worker<CertificateJobData>(
    CERTIFICATE_QUEUE_NAME,
    async (job: Job<CertificateJobData>) => {
      const { enrollment_id } = job.data
      return await processCertificateIssuance(enrollment_id)
    },
    { connection },
  )

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Certificate job completed successfully')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Certificate job failed')
  })

  return worker
}
