import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import { app } from '../app.js'
import { User, type IUser } from '../models/User.js'
import { Internship, type IInternship } from '../models/Internship.js'
import { Enrollment, type IEnrollment } from '../models/Enrollment.js'
import { Certificate, type ICertificate } from '../models/Certificate.js'
import { processCertificateIssuance } from '../workers/certificateWorker.js'
import { emailService } from '../services/email.js'
import { signSessionToken } from '../middleware/auth.js'

describe('Step 7 — Certificate Issuance & Verification Pipeline (SEC-11, SEC-13, SEC-14)', () => {
  interface MockUser {
    _id: mongoose.Types.ObjectId
    email: string
    role: 'student' | 'admin'
    session_version: number
  }

  interface MockInternship {
    _id: mongoose.Types.ObjectId
    title: string
    tasks: Array<{
      task_number: number
      title: string
      description: string
      deadline_days: number
    }>
  }

  interface MockEnrollment {
    _id: mongoose.Types.ObjectId
    user_id: mongoose.Types.ObjectId
    internship_id: mongoose.Types.ObjectId
    status: 'active' | 'expired' | 'completed'
    current_task: number
    start_date: Date
    end_date: Date
    completed_at?: Date | null
  }

  interface MockCertificate {
    _id: mongoose.Types.ObjectId
    enrollment_id: mongoose.Types.ObjectId
    verification_code: string
    pdf_url: string
    issued_at: Date
  }

  const usersStore = new Map<string, MockUser>()
  const internshipsStore = new Map<string, MockInternship>()
  const enrollmentsStore = new Map<string, MockEnrollment>()
  const certificatesStore = new Map<string, MockCertificate>()

  const studentId = new mongoose.Types.ObjectId()
  const adminId = new mongoose.Types.ObjectId()
  const internshipId = new mongoose.Types.ObjectId()
  const enrollmentId = new mongoose.Types.ObjectId()
  const mockCode = '11111111-2222-3333-4444-555555555555'

  const csrfToken = 'test-valid-csrf-token-1234567890123456'
  const csrfCookie = `csrf_token=${csrfToken}`

  function getAuthCookie(
    userId: mongoose.Types.ObjectId,
    role: 'student' | 'admin' = 'student',
  ) {
    const token = signSessionToken(
      { _id: userId, role, session_version: 1 },
      role,
    )
    return `session=${token}`
  }

  beforeEach(() => {
    jest.clearAllMocks()
    usersStore.clear()
    internshipsStore.clear()
    enrollmentsStore.clear()
    certificatesStore.clear()

    // Seed User
    usersStore.set(studentId.toString(), {
      _id: studentId,
      email: 'alex.rivera@example.com',
      role: 'student',
      session_version: 1,
    })
    usersStore.set(adminId.toString(), {
      _id: adminId,
      email: 'admin@interncert.dev',
      role: 'admin',
      session_version: 1,
    })

    // Seed Internship
    internshipsStore.set(internshipId.toString(), {
      _id: internshipId,
      title: 'Full Stack Cloud Architecture',
      tasks: [
        {
          task_number: 1,
          title: 'Infrastructure as Code',
          description: 'Deploy terraform',
          deadline_days: 7,
        },
      ],
    })

    // Seed Completed Enrollment
    enrollmentsStore.set(enrollmentId.toString(), {
      _id: enrollmentId,
      user_id: studentId,
      internship_id: internshipId,
      status: 'completed',
      current_task: 2,
      start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      completed_at: new Date(),
    })

    // Mock User.findById
    jest.spyOn(User, 'findById').mockImplementation((id: unknown) => {
      const u = usersStore.get(String(id))
      return Promise.resolve(u as unknown as IUser)
    })

    // Mock Internship.findById
    jest.spyOn(Internship, 'findById').mockImplementation((id: unknown) => {
      const i = internshipsStore.get(String(id))
      return Promise.resolve(i as unknown as IInternship)
    })

    // Mock Enrollment.findById
    jest.spyOn(Enrollment, 'findById').mockImplementation((id: unknown) => {
      const e = enrollmentsStore.get(String(id))
      return Promise.resolve(e as unknown as IEnrollment)
    })

    // Mock Certificate.findOne
    jest.spyOn(Certificate, 'findOne').mockImplementation((query: unknown) => {
      const q = query as Record<string, unknown>
      for (const c of certificatesStore.values()) {
        const matchEnroll =
          !q.enrollment_id ||
          String(c.enrollment_id) === String(q.enrollment_id)
        const matchCode =
          !q.verification_code || c.verification_code === q.verification_code
        if (matchEnroll && matchCode) {
          return Promise.resolve(c as unknown as ICertificate)
        }
      }
      return Promise.resolve(null)
    })

    // Mock Certificate.create
    jest.spyOn(Certificate, 'create').mockImplementation((data: unknown) => {
      const item = data as Record<string, unknown>
      // Simulate MongoDB unique index constraint
      for (const existing of certificatesStore.values()) {
        if (
          String(existing.enrollment_id) === String(item.enrollment_id) ||
          existing.verification_code === item.verification_code
        ) {
          const duplicateError = new Error(
            'E11000 duplicate key error',
          ) as Error & {
            code?: number
          }
          duplicateError.code = 11000
          return Promise.reject(duplicateError)
        }
      }

      const id = new mongoose.Types.ObjectId()
      const doc: MockCertificate = {
        _id: id,
        enrollment_id: item.enrollment_id as mongoose.Types.ObjectId,
        verification_code: item.verification_code as string,
        pdf_url: item.pdf_url as string,
        issued_at: (item.issued_at as Date) || new Date(),
      }
      certificatesStore.set(id.toString(), doc)
      return Promise.resolve(doc as unknown as ICertificate)
    })
  })

  describe('SEC-11: Verification Endpoint (GET /verify/:code)', () => {
    it('returns authentic certificate minimal details when valid code is queried', async () => {
      const certId = new mongoose.Types.ObjectId()
      certificatesStore.set(certId.toString(), {
        _id: certId,
        enrollment_id: enrollmentId,
        verification_code: mockCode,
        pdf_url: `/verify/${mockCode}/pdf`,
        issued_at: new Date('2026-10-06T12:00:00Z'),
      })

      const res = await request(app).get(`/verify/${mockCode}`)

      expect(res.status).toBe(200)
      expect(res.body.valid).toBe(true)
      expect(res.body.verification_code).toBe(mockCode)
      expect(res.body.student_name).toBe('ALEX RIVERA')
      expect(res.body.internship_title).toBe('Full Stack Cloud Architecture')
      expect(res.body.issued_at).toBe('2026-10-06T12:00:00.000Z')
      expect(res.body.pdf_url).toBe(`/verify/${mockCode}/pdf`)
      // Ensure no internal sensitive fields leaked
      expect(res.body._id).toBeUndefined()
      expect(res.body.user_id).toBeUndefined()
    })

    it('SEC-14: returns 404 without data leak for non-existent verification code', async () => {
      const res = await request(app).get('/verify/non-existent-code-9999')

      expect(res.status).toBe(404)
      expect(res.body.valid).toBe(false)
      expect(res.body.error).toBe('certificate_not_found')
    })

    it('rejects malformed or short verification codes with 400', async () => {
      const res = await request(app).get('/verify/abc')

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('invalid_code')
    })
  })

  describe('SEC-13: Idempotent Certificate Issuance Worker', () => {
    it('generates certificate and dispatches email on initial completion', async () => {
      const emailSpy = jest
        .spyOn(emailService, 'sendCertificateIssuedEmail')
        .mockImplementation(() => Promise.resolve())

      const result = await processCertificateIssuance(enrollmentId.toString())

      expect(result.status).toBe('issued')
      expect(result.certificate).toBeDefined()
      expect(result.certificate.verification_code).toBeDefined()
      expect(certificatesStore.size).toBe(1)
      expect(emailSpy).toHaveBeenCalledTimes(1)
    })

    it('SEC-13: replay/retry produces exactly 1 certificate and 1 email (idempotent no-op)', async () => {
      const emailSpy = jest
        .spyOn(emailService, 'sendCertificateIssuedEmail')
        .mockImplementation(() => Promise.resolve())

      // First run: issues certificate
      const run1 = await processCertificateIssuance(enrollmentId.toString())
      expect(run1.status).toBe('issued')
      expect(certificatesStore.size).toBe(1)
      expect(emailSpy).toHaveBeenCalledTimes(1)

      // Second run (simulating retry or duplicate worker delivery)
      const run2 = await processCertificateIssuance(enrollmentId.toString())
      expect(run2.status).toBe('already_issued')
      expect(run2.certificate.verification_code).toBe(
        run1.certificate.verification_code,
      )
      // Must not create duplicate certificate
      expect(certificatesStore.size).toBe(1)
      // Must not send duplicate email
      expect(emailSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('PDF Generation and Stream (GET /verify/:code/pdf)', () => {
    it('serves PDF stream with application/pdf content type', async () => {
      const certId = new mongoose.Types.ObjectId()
      certificatesStore.set(certId.toString(), {
        _id: certId,
        enrollment_id: enrollmentId,
        verification_code: mockCode,
        pdf_url: `/verify/${mockCode}/pdf`,
        issued_at: new Date(),
      })

      const res = await request(app).get(`/verify/${mockCode}/pdf`)

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('application/pdf')
      // PDF documents begin with the '%PDF-' magic bytes or return binary buffer
      expect(
        Buffer.isBuffer(res.body) ||
          (typeof res.text === 'string' && res.text.startsWith('%PDF-')),
      ).toBe(true)
    })

    it('returns 404 when downloading PDF for non-existent code', async () => {
      const res = await request(app).get('/verify/unknown-code-12345/pdf')

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('certificate_not_found')
    })
  })

  describe('Admin Manual Issuance Trigger (POST /admin/enrollments/:id/issue-certificate)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).post(
        `/admin/enrollments/${enrollmentId}/issue-certificate`,
      )

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('unauthorized')
    })

    it('rejects non-admin users with 403 forbidden', async () => {
      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/issue-certificate`)
        .set('Cookie', [getAuthCookie(studentId, 'student'), csrfCookie])
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('forbidden')
    })

    it('rejects incomplete enrollment with 400', async () => {
      const incompleteId = new mongoose.Types.ObjectId()
      enrollmentsStore.set(incompleteId.toString(), {
        _id: incompleteId,
        user_id: studentId,
        internship_id: internshipId,
        status: 'active',
        current_task: 1,
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        completed_at: null, // Not completed
      })

      const res = await request(app)
        .post(`/admin/enrollments/${incompleteId}/issue-certificate`)
        .set('Cookie', [getAuthCookie(adminId, 'admin'), csrfCookie])
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('enrollment_not_completed')
    })

    it('accepts completed enrollment and enqueues job with 202', async () => {
      const res = await request(app)
        .post(`/admin/enrollments/${enrollmentId}/issue-certificate`)
        .set('Cookie', [getAuthCookie(adminId, 'admin'), csrfCookie])
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(202)
      expect(res.body.status).toBe('queued')
    })
  })
})
