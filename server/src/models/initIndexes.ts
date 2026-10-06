import { User } from './User.js'
import { Internship } from './Internship.js'
import { Enrollment } from './Enrollment.js'
import { TaskSubmission } from './TaskSubmission.js'
import { Payment } from './Payment.js'
import { Certificate } from './Certificate.js'
import { AuditLog } from './AuditLog.js'
import { logger } from '../config/logger.js'

export interface IndexableModel {
  modelName: string
  createIndexes: () => Promise<unknown>
}

export const ALL_MODELS: IndexableModel[] = [
  User,
  Internship,
  Enrollment,
  TaskSubmission,
  Payment,
  Certificate,
  AuditLog,
]

/**
 * Explicitly builds and synchronizes all Mongoose indexes.
 * In non-production, this runs at server boot (ensureIndexes).
 * In production, it can be run as a checked-in migration or pre-deploy hook.
 */
export async function initAllIndexes(): Promise<void> {
  logger.info('Initializing and verifying database indexes for all models...')

  for (const model of ALL_MODELS) {
    try {
      await model.createIndexes()
      logger.info(
        { model: model.modelName },
        'Model indexes synchronized successfully',
      )
    } catch (err) {
      logger.error(
        { model: model.modelName, err },
        'Failed to synchronize model indexes',
      )
      throw err
    }
  }

  logger.info('All model indexes verified successfully')
}
