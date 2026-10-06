import { describe, it, expect } from '@jest/globals'
import mongoose from 'mongoose'
import { Internship } from './Internship.js'
import { Enrollment } from './Enrollment.js'
import { TaskSubmission } from './TaskSubmission.js'
import { Payment } from './Payment.js'
import { Certificate } from './Certificate.js'
import { AuditLog } from './AuditLog.js'
import { ALL_MODELS } from './initIndexes.js'

describe('Step 4 — Domain Models & Invariants', () => {
  it('registers all 7 models in the system index registry', () => {
    const modelNames = ALL_MODELS.map((m) => m.modelName)
    expect(modelNames).toContain('User')
    expect(modelNames).toContain('Internship')
    expect(modelNames).toContain('Enrollment')
    expect(modelNames).toContain('TaskSubmission')
    expect(modelNames).toContain('Payment')
    expect(modelNames).toContain('Certificate')
    expect(modelNames).toContain('AuditLog')
  })

  describe('Internship Model', () => {
    it('validates required fields and taskSchema with deadline_days', () => {
      const internship = new Internship({
        title: 'Backend Engineering with Node.js',
        description: 'Complete hands-on API tasks.',
        tasks: [
          {
            task_number: 1,
            title: 'Setup DB and Auth',
            description: 'Implement JWT session cookies.',
            deadline_days: 7,
          },
        ],
        price: 4999,
        currency: 'INR',
      })

      const err = internship.validateSync()
      expect(err).toBeUndefined()
      expect(internship.tasks[0].deadline_days).toBe(7)
      expect(internship.is_active).toBe(true)
    })

    it('rejects internships without tasks', () => {
      const internship = new Internship({
        title: 'Empty Internship',
        description: 'No tasks provided.',
        tasks: [],
        price: 1999,
      })

      const err = internship.validateSync()
      expect(err).toBeDefined()
      expect(err?.errors['tasks']).toBeDefined()
    })
  })

  describe('Enrollment Model Invariants', () => {
    it('defines a partial unique index on { user_id: 1, internship_id: 1 } filtered to status: "active"', () => {
      const indexes = Enrollment.schema.indexes()
      const partialIndex = indexes.find(([fields, options]) => {
        return (
          fields.user_id === 1 &&
          fields.internship_id === 1 &&
          options?.unique === true &&
          options?.partialFilterExpression?.status === 'active'
        )
      })

      expect(partialIndex).toBeDefined()
      expect(partialIndex?.[1]?.name).toBe('unique_active_user_internship')
    })

    it('validates enrollment status enum', () => {
      const validEnrollment = new Enrollment({
        user_id: new mongoose.Types.ObjectId(),
        internship_id: new mongoose.Types.ObjectId(),
        status: 'active',
        current_task: 1,
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      expect(validEnrollment.validateSync()).toBeUndefined()

      const invalidEnrollment = new Enrollment({
        user_id: new mongoose.Types.ObjectId(),
        internship_id: new mongoose.Types.ObjectId(),
        status: 'invalid_status_value',
        end_date: new Date(),
      })
      const err = invalidEnrollment.validateSync()
      expect(err).toBeDefined()
      expect(err?.errors['status']).toBeDefined()
    })
  })

  describe('TaskSubmission Model', () => {
    it('validates task submission status enum and indexes', () => {
      const submission = new TaskSubmission({
        enrollment_id: new mongoose.Types.ObjectId(),
        task_number: 1,
        status: 'pending',
        content: 'https://github.com/interncert/student-submission',
      })

      expect(submission.validateSync()).toBeUndefined()
      expect(submission.status).toBe('pending')

      const indexes = TaskSubmission.schema.indexes()
      const enrollmentTaskIndex = indexes.find(
        ([fields]) => fields.enrollment_id === 1 && fields.task_number === 1,
      )
      expect(enrollmentTaskIndex).toBeDefined()
    })
  })

  describe('Payment Model Invariants', () => {
    it('enforces unique index on razorpay_order_id', () => {
      const indexes = Payment.schema.indexes()
      const orderIdIndex = indexes.find(
        ([fields, options]) =>
          fields.razorpay_order_id === 1 && options?.unique === true,
      )

      expect(orderIdIndex).toBeDefined()
    })

    it('validates payment status state machine values', () => {
      const allowedStatuses = [
        'created',
        'paid',
        'failed',
        'refunded',
        'partially_refunded',
      ]

      for (const status of allowedStatuses) {
        const payment = new Payment({
          user_id: new mongoose.Types.ObjectId(),
          internship_id: new mongoose.Types.ObjectId(),
          razorpay_order_id: `order_${status}_123`,
          amount: 299900,
          currency: 'INR',
          status,
        })
        expect(payment.validateSync()).toBeUndefined()
      }
    })
  })

  describe('Certificate Model Invariants', () => {
    it('enforces unique index on enrollment_id (1 certificate per enrollment max)', () => {
      const indexes = Certificate.schema.indexes()
      const enrollmentIndex = indexes.find(
        ([fields, options]) =>
          fields.enrollment_id === 1 && options?.unique === true,
      )

      expect(enrollmentIndex).toBeDefined()
    })

    it('enforces unique index on verification_code (SEC-14 unguessable code)', () => {
      const indexes = Certificate.schema.indexes()
      const codeIndex = indexes.find(
        ([fields, options]) =>
          fields.verification_code === 1 && options?.unique === true,
      )

      expect(codeIndex).toBeDefined()
    })
  })

  describe('AuditLog Append-Only Invariants', () => {
    it('prohibits update and delete operations at Mongoose middleware level', () => {
      const entry = new AuditLog({
        admin_id: new mongoose.Types.ObjectId(),
        action: 'TASK_APPROVED',
        target_type: 'TaskSubmission',
        target_id: 'sub_123',
        before: { status: 'pending' },
        after: { status: 'approved' },
      })
      expect(entry.validateSync()).toBeUndefined()

      // Verify that calling update/delete query hooks throws error
      expect(() => {
        AuditLog.schema.eachPath(() => {})
      }).not.toThrow()

      interface MongooseHookWrapper {
        fn: () => void
      }
      interface SchemaWithInternals {
        s?: {
          hooks?: {
            _pres?: Map<string, MongooseHookWrapper[]>
          }
        }
      }

      const schemaInternals = AuditLog.schema as unknown as SchemaWithInternals
      const preHooks = schemaInternals.s?.hooks?._pres
      expect(preHooks).toBeDefined()

      const mutationHookNames = [
        'updateOne',
        'updateMany',
        'findOneAndUpdate',
        'deleteOne',
        'deleteMany',
        'findOneAndDelete',
      ]

      for (const hookName of mutationHookNames) {
        const hooks = preHooks?.get(hookName)
        expect(hooks).toBeDefined()
        const customHook = hooks?.find((h: MongooseHookWrapper) => {
          try {
            h.fn()
            return false
          } catch (e: unknown) {
            return (
              (e as Error).message ===
              'AuditLog is append-only: update and delete operations are prohibited.'
            )
          }
        })
        expect(customHook).toBeDefined()
      }
    })
  })
})
