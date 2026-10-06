import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import * as OTPAuth from 'otpauth'
import { app } from '../app.js'
import { User, type IUser } from '../models/User.js'
import { Certificate, type ICertificate } from '../models/Certificate.js'
import { Payment, type IPayment } from '../models/Payment.js'
import {
  TaskSubmission,
  type ITaskSubmission,
} from '../models/TaskSubmission.js'
import { AuditLog, type IAuditLog } from '../models/AuditLog.js'
import { razorpayService } from '../services/razorpay.js'
import { signSessionToken } from '../middleware/auth.js'

describe('Step 8 — Admin Surface & Step-Up MFA (SEC-12, SEC-15)', () => {
  interface MockUser {
    _id: mongoose.Types.ObjectId
    email: string
    role: 'student' | 'admin'
    session_version: number
    totp_secret?: string | null
    totp_enabled?: boolean
  }

  interface MockCertificate {
    _id: mongoose.Types.ObjectId
    enrollment_id: mongoose.Types.ObjectId
    verification_code: string
    pdf_url: string
    status: 'valid' | 'revoked'
    issued_at: Date
    revoked_at?: Date | null
    revoked_reason?: string | null
    revoked_by?: mongoose.Types.ObjectId | null
    save?: () => Promise<MockCertificate>
  }

  interface MockPayment {
    _id: mongoose.Types.ObjectId
    user_id: mongoose.Types.ObjectId
    amount: number
    status: string
    razorpay_payment_id?: string
    save?: () => Promise<MockPayment>
  }

  interface MockAuditLog {
    _id: mongoose.Types.ObjectId
    admin_id: mongoose.Types.ObjectId
    action: string
    target_type: string
    target_id: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    createdAt: Date
  }

  const usersStore = new Map<string, MockUser>()
  const certificatesStore = new Map<string, MockCertificate>()
  const paymentsStore = new Map<string, MockPayment>()
  const auditLogsStore = new Map<string, MockAuditLog>()

  const adminId = new mongoose.Types.ObjectId()
  const studentId = new mongoose.Types.ObjectId()
  const enrollmentId = new mongoose.Types.ObjectId()
  const certId = new mongoose.Types.ObjectId()
  const paymentId = new mongoose.Types.ObjectId()

  const secret = new OTPAuth.Secret({ size: 20 })
  const base32Secret = secret.base32
  const totpGenerator = new OTPAuth.TOTP({
    secret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  })

  const csrfToken = 'valid-csrf-token-1234567890abcdef'
  const csrfCookie = `csrf_token=${csrfToken}`

  function getAuthCookie(
    userId: mongoose.Types.ObjectId,
    role: 'student' | 'admin' = 'admin',
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
    certificatesStore.clear()
    paymentsStore.clear()
    auditLogsStore.clear()

    // Seed Admin with TOTP enabled
    usersStore.set(adminId.toString(), {
      _id: adminId,
      email: 'root.admin@interncert.dev',
      role: 'admin',
      session_version: 1,
      totp_secret: base32Secret,
      totp_enabled: true,
    })

    // Seed Student
    usersStore.set(studentId.toString(), {
      _id: studentId,
      email: 'student@example.com',
      role: 'student',
      session_version: 1,
    })

    // Seed Certificate
    certificatesStore.set(certId.toString(), {
      _id: certId,
      enrollment_id: enrollmentId,
      verification_code: 'IC-VALID-CERT-12345678',
      pdf_url: '/verify/IC-VALID-CERT-12345678/pdf',
      status: 'valid',
      issued_at: new Date(),
    })

    // Seed Paid Payment
    paymentsStore.set(paymentId.toString(), {
      _id: paymentId,
      user_id: studentId,
      amount: 499900,
      status: 'paid',
      razorpay_payment_id: 'pay_mock123456',
    })

    // Mock User.findById
    jest.spyOn(User, 'findById').mockImplementation((id: unknown) => {
      const u = usersStore.get(String(id))
      return Promise.resolve(u as unknown as IUser)
    })

    // Mock User.findByIdAndUpdate
    jest
      .spyOn(User, 'findByIdAndUpdate')
      .mockImplementation((id: unknown, update: unknown) => {
        const u = usersStore.get(String(id))
        if (!u) return Promise.resolve(null)
        const updateObj = update as Partial<MockUser>
        Object.assign(u, updateObj)
        usersStore.set(String(id), u)
        return Promise.resolve(u as unknown as IUser)
      })

    // Mock Certificate.findOne
    jest.spyOn(Certificate, 'findOne').mockImplementation((query: unknown) => {
      const q = query as Record<string, unknown>
      for (const c of certificatesStore.values()) {
        const matchCode =
          !q.verification_code || c.verification_code === q.verification_code
        let matchOr = true
        if (Array.isArray(q.$or)) {
          matchOr = q.$or.some((clause: Record<string, unknown>) => {
            if (clause._id && String(clause._id) === String(c._id)) return true
            if (
              clause.verification_code &&
              clause.verification_code === c.verification_code
            )
              return true
            return false
          })
        }
        if (matchCode && matchOr) {
          c.save = async function () {
            certificatesStore.set(this._id.toString(), this)
            return this
          }
          return Promise.resolve(c as unknown as ICertificate)
        }
      }
      return Promise.resolve(null)
    })

    // Mock Certificate.find
    jest.spyOn(Certificate, 'find').mockImplementation(() => {
      const list = Array.from(certificatesStore.values())
      const queryObj = {
        sort: () => queryObj,
        skip: () => queryObj,
        limit: (n: number) => {
          return {
            populate: () => Promise.resolve(list.slice(0, n)),
          }
        },
      }
      return queryObj as unknown as mongoose.Query<ICertificate[], ICertificate>
    })

    // Mock Payment.findById
    jest.spyOn(Payment, 'findById').mockImplementation((id: unknown) => {
      const p = paymentsStore.get(String(id))
      if (!p) return Promise.resolve(null)
      p.save = async function () {
        paymentsStore.set(this._id.toString(), this)
        return this
      }
      return Promise.resolve(p as unknown as IPayment)
    })

    // Mock AuditLog.create
    jest.spyOn(AuditLog, 'create').mockImplementation((data: unknown) => {
      const id = new mongoose.Types.ObjectId()
      const d = data as MockAuditLog
      const log = { _id: id, ...d, createdAt: new Date() }
      auditLogsStore.set(id.toString(), log)
      return Promise.resolve(log as unknown as IAuditLog)
    })

    // Mock AuditLog.find
    jest.spyOn(AuditLog, 'find').mockImplementation(() => {
      const list = Array.from(auditLogsStore.values())
      const queryObj = {
        sort: () => queryObj,
        skip: () => queryObj,
        limit: (n: number) => {
          return {
            populate: () => Promise.resolve(list.slice(0, n)),
          }
        },
      }
      return queryObj as unknown as mongoose.Query<IAuditLog[], IAuditLog>
    })

    // Mock TaskSubmission.find
    jest.spyOn(TaskSubmission, 'find').mockImplementation(() => {
      const queryObj = {
        sort: () => queryObj,
        skip: () => queryObj,
        limit: () => ({
          populate: () => Promise.resolve([]),
        }),
      }
      return queryObj as unknown as mongoose.Query<
        ITaskSubmission[],
        ITaskSubmission
      >
    })
  })

  describe('Strict DTO Validation (Reject Unknown Keys)', () => {
    it('rejects review request with unexpected fields (400 validation_error)', async () => {
      const submissionId = new mongoose.Types.ObjectId()
      const res = await request(app)
        .post(`/admin/submissions/${submissionId}/review`)
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({
          decision: 'approved',
          feedback: 'Valid feedback',
          unknown_attacker_field: 'malicious_override', // Unknown key
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('validation_error')
    })

    it('rejects revocation request with unexpected fields (400 validation_error)', async () => {
      const res = await request(app)
        .post(`/admin/certificates/${certId}/revoke`)
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .set('x-mfa-code', totpGenerator.generate())
        .send({
          reason: 'Plagiarism in final submission',
          injected_field: true,
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('validation_error')
    })
  })

  describe('Server-Side Pagination Clamping (Max 100)', () => {
    it('clamps limit to 100 for getPendingSubmissions when requested limit > 100', async () => {
      const res = await request(app)
        .get('/admin/submissions/pending?limit=999')
        .set('Cookie', getAuthCookie(adminId))

      expect(res.status).toBe(200)
      expect(res.body.limit).toBe(100)
    })

    it('clamps limit to 100 for getAuditLogs when requested limit > 100', async () => {
      const res = await request(app)
        .get('/admin/audit-logs?limit=500')
        .set('Cookie', getAuthCookie(adminId))

      expect(res.status).toBe(200)
      expect(res.body.limit).toBe(100)
    })

    it('clamps limit to minimum 1 when negative limit is passed', async () => {
      const res = await request(app)
        .get('/admin/certificates?limit=-10')
        .set('Cookie', getAuthCookie(adminId))

      expect(res.status).toBe(200)
      expect(res.body.limit).toBe(1)
    })
  })

  describe('Admin TOTP MFA Setup & Activation', () => {
    it('initiates MFA setup with secret and QR code URI', async () => {
      const res = await request(app)
        .post('/admin/mfa/setup')
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(200)
      expect(res.body.secret).toBeDefined()
      expect(res.body.uri).toContain('otpauth://totp/InternCert')
      expect(res.body.qr_code).toMatch(/^data:image\/png;base64,/)
    })

    it('activates MFA on successful verification and creates audit log entry', async () => {
      const liveToken = totpGenerator.generate()

      const res = await request(app)
        .post('/admin/mfa/verify')
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({ totp_code: liveToken })

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('success')

      // Verify AuditLog written
      expect(auditLogsStore.size).toBe(1)
      const audit = Array.from(auditLogsStore.values())[0]
      expect(audit.action).toBe('ENABLE_MFA')
      expect(audit.target_id).toBe(adminId.toString())
    })

    it('rejects invalid TOTP verification code with 400', async () => {
      const res = await request(app)
        .post('/admin/mfa/verify')
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({ totp_code: '000000' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('invalid_code')
    })
  })

  describe('SEC-15: Certificate Revocation with MFA Step-Up Gate', () => {
    it('rejects revocation without MFA code with 403 (mfa_required)', async () => {
      const res = await request(app)
        .post(`/admin/certificates/${certId}/revoke`)
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({ reason: 'Academic dishonesty' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('mfa_required')
    })

    it('rejects revocation with wrong MFA code with 403 (invalid_mfa_code)', async () => {
      const res = await request(app)
        .post(`/admin/certificates/${certId}/revoke`)
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .set('x-mfa-code', '999999')
        .send({ reason: 'Academic dishonesty' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('invalid_mfa_code')
    })

    it('SEC-15: successfully revokes certificate when valid MFA token provided & writes audit log', async () => {
      const validToken = totpGenerator.generate()

      const res = await request(app)
        .post(`/admin/certificates/${certId}/revoke`)
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .set('x-mfa-code', validToken)
        .send({ reason: 'Plagiarism confirmed during external audit' })

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('success')
      expect(res.body.certificate.status).toBe('revoked')
      expect(res.body.certificate.revoked_reason).toBe(
        'Plagiarism confirmed during external audit',
      )

      // Invariant: Certificate state persisted as revoked
      const updatedCert = certificatesStore.get(certId.toString())
      expect(updatedCert?.status).toBe('revoked')

      // Invariant SEC-15: AuditLog row written
      expect(auditLogsStore.size).toBe(1)
      const audit = Array.from(auditLogsStore.values())[0]
      expect(audit.action).toBe('REVOKE_CERTIFICATE')
      expect(audit.target_id).toBe(certId.toString())
    })

    it('rejects second revocation attempt with 409 already_revoked', async () => {
      const validToken = totpGenerator.generate()

      // Revoke once
      await request(app)
        .post(`/admin/certificates/${certId}/revoke`)
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .set('x-mfa-code', validToken)
        .send({ reason: 'First revocation' })

      // Attempt second revocation
      const res = await request(app)
        .post(`/admin/certificates/${certId}/revoke`)
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .set('x-mfa-code', validToken)
        .send({ reason: 'Second attempt' })

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('already_revoked')
    })
  })

  describe('Refund Processing with MFA Step-Up Gate', () => {
    it('rejects refund without MFA code with 403', async () => {
      const res = await request(app)
        .post(`/admin/payments/${paymentId}/refund`)
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({ reason: 'Customer requested refund' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('mfa_required')
    })

    it('processes refund with valid MFA token and writes audit log', async () => {
      const refundSpy = jest
        .spyOn(razorpayService, 'refundPayment')
        .mockImplementation(() => Promise.resolve({ id: 'rfnd_123' }))

      const validToken = totpGenerator.generate()

      const res = await request(app)
        .post(`/admin/payments/${paymentId}/refund`)
        .set('Cookie', [getAuthCookie(adminId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .set('x-mfa-code', validToken)
        .send({ reason: 'Refund processed per policy' })

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('success')
      expect(res.body.payment.status).toBe('refunded')
      expect(refundSpy).toHaveBeenCalledTimes(1)

      // Invariant: AuditLog entry written
      expect(auditLogsStore.size).toBe(1)
      const audit = Array.from(auditLogsStore.values())[0]
      expect(audit.action).toBe('REFUND_PAYMENT')
    })
  })
})
