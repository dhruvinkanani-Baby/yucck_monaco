import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import { app } from '../app.js'
import { User, type IUser } from '../models/User.js'
import { Internship } from '../models/Internship.js'
import { Payment } from '../models/Payment.js'
import { Certificate } from '../models/Certificate.js'
import { signSessionToken } from '../middleware/auth.js'

describe('Step 10 — Cross-Cutting Hardening Pass', () => {
  const adminId = new mongoose.Types.ObjectId()
  const studentId = new mongoose.Types.ObjectId()

  beforeEach(() => {
    jest.spyOn(User, 'findById').mockImplementation(((id: unknown) => {
      if (String(id) === adminId.toHexString()) {
        return Promise.resolve({
          _id: adminId,
          email: 'admin@example.com',
          role: 'admin',
          session_version: 1,
        } as unknown as IUser)
      }
      if (String(id) === studentId.toHexString()) {
        return Promise.resolve({
          _id: studentId,
          email: 'student@example.com',
          role: 'student',
          session_version: 1,
        } as unknown as IUser)
      }
      return Promise.resolve(null)
    }) as unknown as typeof User.findById)
  })

  describe('ObjectId Validation Middleware', () => {
    it('returns structured 400 for invalid ObjectId on public /internships/:id', async () => {
      const res = await request(app).get('/internships/not-a-valid-object-id')
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('invalid_id_format')
      expect(res.body.message).toContain('id')
    })

    it('returns structured 400 for invalid ObjectId on protected /admin/submissions/:id/review', async () => {
      const adminToken = signSessionToken(
        { _id: adminId, role: 'admin', session_version: 1 },
        'admin',
      )

      const res = await request(app)
        .post('/admin/submissions/malformed-id-123/review')
        .set('Cookie', [`session=${adminToken}`])
        .send({ decision: 'approved' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('invalid_id_format')
    })

    it('returns structured 400 for invalid ObjectId on /tasks/enrollment/:enrollment_id', async () => {
      const studentToken = signSessionToken(
        { _id: studentId, role: 'student', session_version: 1 },
        'student',
      )

      const res = await request(app)
        .get('/tasks/enrollment/invalid-enrollment-id')
        .set('Cookie', [`session=${studentToken}`])

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('invalid_id_format')
      expect(res.body.message).toContain('enrollment_id')
    })
  })

  describe('Regex-Escape on Search Queries', () => {
    it('safely handles ReDoS characters and regex wildcards in search query without crashing', async () => {
      jest.spyOn(Internship, 'find').mockImplementation(((_filter: unknown) => {
        const queryObj: {
          sort: () => typeof queryObj
          skip: () => typeof queryObj
          limit: () => typeof queryObj
          then: (resolve: (v: unknown) => unknown) => Promise<unknown>
        } = {
          sort: () => queryObj,
          skip: () => queryObj,
          limit: () => queryObj,
          then: (resolve) => Promise.resolve([]).then(resolve),
        }
        return queryObj as unknown as ReturnType<typeof Internship.find>
      }) as unknown as typeof Internship.find)

      jest.spyOn(Internship, 'countDocuments').mockImplementation(() => {
        return Promise.resolve(0) as unknown as ReturnType<
          typeof Internship.countDocuments
        >
      })

      // Send dangerous regex pattern
      const dangerousQuery = '.*+?^${}()|[]\\'
      const res = await request(app).get(
        `/internships?q=${encodeURIComponent(dangerousQuery)}`,
      )

      expect(res.status).toBe(200)
      expect(res.body.internships).toEqual([])
    })
  })

  describe('Mongoose Schema Hardening & Maxlength / Format Constraints', () => {
    it('rejects invalid email formats at the Mongoose schema layer', async () => {
      const invalidUser = new User({
        email: 'not-an-email',
        password_hash: 'hashedpassword',
        role: 'student',
      })

      let validationError = null
      try {
        await invalidUser.validate()
      } catch (err) {
        validationError = err
      }

      expect(validationError).not.toBeNull()
    })

    it('rejects currency strings not matching format or exceeding maxlength', async () => {
      const invalidInternship = new Internship({
        title: 'Security Track',
        description:
          'Detailed description of the program for testing purposes.',
        price: 500,
        currency: 'TOOLONG_CURRENCY_CODE',
        tasks: [
          {
            task_number: 1,
            title: 'Task 1',
            description: 'Description',
            deadline_days: 7,
          },
        ],
      })

      let validationError = null
      try {
        await invalidInternship.validate()
      } catch (err) {
        validationError = err
      }

      expect(validationError).not.toBeNull()
    })

    it('rejects certificate verification codes that do not conform to UUID format', async () => {
      const invalidCert = new Certificate({
        enrollment_id: new mongoose.Types.ObjectId(),
        verification_code: 'non-uuid-code-too-short',
        pdf_url: 'https://example.com/cert.pdf',
      })

      let validationError = null
      try {
        await invalidCert.validate()
      } catch (err) {
        validationError = err
      }

      expect(validationError).not.toBeNull()
    })

    it('rejects payment records with invalid currency format', async () => {
      const invalidPayment = new Payment({
        user_id: new mongoose.Types.ObjectId(),
        internship_id: new mongoose.Types.ObjectId(),
        razorpay_order_id: 'order_123',
        amount: 500,
        currency: '123_invalid',
      })

      let validationError = null
      try {
        await invalidPayment.validate()
      } catch (err) {
        validationError = err
      }

      expect(validationError).not.toBeNull()
    })
  })
})
