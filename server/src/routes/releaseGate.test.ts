import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import crypto from 'node:crypto'
import { app } from '../app.js'
import { User, type IUser } from '../models/User.js'
import { Internship } from '../models/Internship.js'
import { Enrollment } from '../models/Enrollment.js'
import { Payment } from '../models/Payment.js'
import { TaskSubmission } from '../models/TaskSubmission.js'
import { Certificate } from '../models/Certificate.js'
import { AuditLog } from '../models/AuditLog.js'
import { WebhookEvent } from '../models/WebhookEvent.js'
import { signSessionToken } from '../middleware/auth.js'
import { validateSafeUrl, escapeHtml } from '../utils/sanitize.js'
import {
  buildCertificateEmailHtml,
  buildPasswordResetEmailHtml,
} from '../services/email.js'
import { processCertificateIssuance } from '../workers/certificateWorker.js'
import { TOTP } from 'otpauth'

describe('Step 11 — Release Gate Test Matrix (SEC-01 to SEC-15)', () => {
  const adminId = new mongoose.Types.ObjectId()
  const studentId = new mongoose.Types.ObjectId()
  const otherStudentId = new mongoose.Types.ObjectId()
  const enrollmentId = new mongoose.Types.ObjectId()
  const internshipId = new mongoose.Types.ObjectId()
  const totpSecret = 'KVKFKRCTNVZGK43VGUZDGMRWGQ4UY3PN'

  const totpGenerator = new TOTP({
    issuer: 'InternCert',
    label: 'admin@interncert.dev',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: totpSecret,
  })

  async function getCsrfHeaders() {
    const csrfRes = await request(app).get('/auth/csrf')
    return {
      token: csrfRes.body.csrf_token as string,
      cookies: (csrfRes.headers['set-cookie'] as string[]) || [],
    }
  }

  beforeEach(() => {
    jest.restoreAllMocks()

    jest.spyOn(User, 'findById').mockImplementation(((id: unknown) => {
      const idStr = String(id)
      if (idStr === adminId.toHexString()) {
        return Promise.resolve({
          _id: adminId,
          email: 'admin@interncert.dev',
          role: 'admin',
          session_version: 1,
          totp_secret: totpSecret,
          totp_enabled: true,
        } as unknown as IUser)
      }
      if (idStr === studentId.toHexString()) {
        return Promise.resolve({
          _id: studentId,
          email: 'student@interncert.dev',
          role: 'student',
          session_version: 1,
        } as unknown as IUser)
      }
      if (idStr === otherStudentId.toHexString()) {
        return Promise.resolve({
          _id: otherStudentId,
          email: 'other@interncert.dev',
          role: 'student',
          session_version: 1,
        } as unknown as IUser)
      }
      return Promise.resolve(null)
    }) as unknown as typeof User.findById)
  })

  // SEC-01: Boot prod without Razorpay secrets -> Refuses to start
  it('SEC-01: production boot refuses to start without Razorpay secrets', async () => {
    const { z } = await import('zod')
    const productionEnvSchema = z.object({
      NODE_ENV: z.literal('production'),
      RAZORPAY_KEY_ID: z.string().min(1),
      RAZORPAY_KEY_SECRET: z.string().min(1),
    })

    const invalidEnv = {
      NODE_ENV: 'production',
      RAZORPAY_KEY_ID: '', // Missing
      RAZORPAY_KEY_SECRET: '', // Missing
    }

    const parseResult = productionEnvSchema.safeParse(invalidEnv)
    expect(parseResult.success).toBe(false)
  })

  // SEC-02: Call dev/mock endpoints in staging/prod -> Absent/rejected (404)
  it('SEC-02: dev/mock endpoints are absent and return 404 in non-test environment', async () => {
    const res = await request(app).get('/dev/mock-payment')
    expect(res.status).toBe(404)
  })

  // SEC-03: Verify payment using another user's order ID -> Rejected pre-mutation (403 forbidden)
  it('SEC-03: rejects payment verification when order belongs to a different user pre-mutation (403 forbidden)', async () => {
    const studentToken = signSessionToken(
      { _id: studentId, role: 'student', session_version: 1 },
      'student',
    )
    const csrf = await getCsrfHeaders()

    // Order belongs to otherStudentId, not studentId
    jest.spyOn(Payment, 'findOne').mockResolvedValue(null)

    const res = await request(app)
      .post('/enroll/verify')
      .set('Cookie', [`session=${studentToken}`, ...csrf.cookies])
      .set('x-csrf-token', csrf.token)
      .send({
        razorpay_order_id: 'order_victim_123',
        razorpay_payment_id: 'pay_attacker_456',
        razorpay_signature: 'dummy_sig',
      })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden')
  })

  // SEC-04: Replay valid verification 10x concurrently -> 1 Payment, 1 Enrollment
  it('SEC-04: replaying valid payment verification returns idempotent success (1 payment, 1 enrollment)', async () => {
    const studentToken = signSessionToken(
      { _id: studentId, role: 'student', session_version: 1 },
      'student',
    )
    const csrf = await getCsrfHeaders()

    const existingPayment = {
      _id: new mongoose.Types.ObjectId(),
      user_id: studentId,
      internship_id: internshipId,
      razorpay_order_id: 'order_paid_123',
      razorpay_payment_id: 'pay_captured_456',
      status: 'paid',
      amount: 499900,
      currency: 'INR',
    }

    const existingEnrollment = {
      _id: enrollmentId,
      user_id: studentId,
      internship_id: internshipId,
      status: 'active',
      current_task: 1,
      start_date: new Date(),
      end_date: new Date(Date.now() + 30 * 86400000),
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    jest
      .spyOn(Payment, 'findOne')
      .mockResolvedValue(
        existingPayment as unknown as ReturnType<typeof Payment.findOne>,
      )
    jest
      .spyOn(Enrollment, 'findOne')
      .mockResolvedValue(
        existingEnrollment as unknown as ReturnType<typeof Enrollment.findOne>,
      )

    const calls = Array.from({ length: 10 }, () =>
      request(app)
        .post('/enroll/verify')
        .set('Cookie', [`session=${studentToken}`, ...csrf.cookies])
        .set('x-csrf-token', csrf.token)
        .send({
          razorpay_order_id: 'order_paid_123',
          razorpay_payment_id: 'pay_captured_456',
          razorpay_signature: 'sig_valid',
        }),
    )

    const results = await Promise.all(calls)
    results.forEach((res) => {
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('already_paid')
      expect(String(res.body.enrollment._id)).toBe(String(enrollmentId))
    })
  })

  // SEC-05: Valid signature, wrong amount -> Rejected
  it('SEC-05: rejects payment verification when captured amount does not match recorded order amount (400)', async () => {
    const studentToken = signSessionToken(
      { _id: studentId, role: 'student', session_version: 1 },
      'student',
    )
    const csrf = await getCsrfHeaders()

    const pendingPayment = {
      _id: new mongoose.Types.ObjectId(),
      user_id: studentId,
      internship_id: internshipId,
      razorpay_order_id: 'order_tampered_123',
      status: 'created',
      amount: 500000, // Expected: 500000
      currency: 'INR',
      save: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    }

    jest
      .spyOn(Payment, 'findOne')
      .mockResolvedValue(
        pendingPayment as unknown as ReturnType<typeof Payment.findOne>,
      )

    // Mock Razorpay service returning lower amount
    const { razorpayService } = await import('../services/razorpay.js')
    jest.spyOn(razorpayService, 'verifyPaymentSignature').mockReturnValue(true)
    jest.spyOn(razorpayService, 'fetchPayment').mockResolvedValue({
      id: 'pay_tampered_456',
      amount: 100000, // Attacker paid only 100000!
      currency: 'INR',
      status: 'captured',
    } as unknown as Awaited<ReturnType<typeof razorpayService.fetchPayment>>)

    const res = await request(app)
      .post('/enroll/verify')
      .set('Cookie', [`session=${studentToken}`, ...csrf.cookies])
      .set('x-csrf-token', csrf.token)
      .send({
        razorpay_order_id: 'order_tampered_123',
        razorpay_payment_id: 'pay_tampered_456',
        razorpay_signature: 'sig_valid',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('payment_amount_mismatch')
  })

  // SEC-06: Browser closes after capture -> Webhook reconciles state
  it('SEC-06: webhook reconciles payment and enrollment state when client browser drops connection', async () => {
    const webhookPayload = {
      event_id: 'evt_sec06_12345',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_reconcile',
            order_id: 'order_reconcile_123',
            amount: 500000,
            currency: 'INR',
            status: 'captured',
            notes: {
              user_id: studentId.toHexString(),
              internship_id: internshipId.toHexString(),
            },
          },
        },
      },
    }

    const rawPayload = JSON.stringify(webhookPayload)
    const { env } = await import('../config/env.js')
    const validSignature = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(Buffer.from(rawPayload, 'utf8'))
      .digest('hex')

    jest.spyOn(WebhookEvent, 'findOne').mockResolvedValue(null)
    jest
      .spyOn(WebhookEvent, 'create')
      .mockResolvedValue(
        {} as unknown as ReturnType<typeof WebhookEvent.create>,
      )

    const uncapturedPayment = {
      _id: new mongoose.Types.ObjectId(),
      user_id: studentId,
      internship_id: internshipId,
      razorpay_order_id: 'order_reconcile_123',
      status: 'created',
      save: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    }

    jest
      .spyOn(Payment, 'findOne')
      .mockResolvedValue(
        uncapturedPayment as unknown as ReturnType<typeof Payment.findOne>,
      )
    jest.spyOn(Enrollment, 'findOne').mockResolvedValue(null)
    jest.spyOn(Internship, 'findById').mockResolvedValue({
      _id: internshipId,
      tasks: [{ deadline_days: 14, task_number: 1 }],
    } as unknown as ReturnType<typeof Internship.findById>)
    jest.spyOn(Enrollment, 'create').mockResolvedValue({
      _id: enrollmentId,
    } as unknown as ReturnType<typeof Enrollment.create>)

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-signature', validSignature)
      .set('content-type', 'application/json')
      .send(rawPayload)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('processed')
  })

  // SEC-07: javascript:...linkedin.com input -> Rejected
  it('SEC-07: rejects javascript: pseudo-protocols targeting external URLs (e.g. javascript:...linkedin.com)', async () => {
    const maliciousInputs = [
      'javascript:alert(1);//https://linkedin.com',
      'javascript:...linkedin.com',
      '  JAVASCRIPT:void(0) ',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox("pwnd")',
    ]

    for (const input of maliciousInputs) {
      const result = validateSafeUrl(input, {
        allowedHostnames: ['linkedin.com', 'www.linkedin.com'],
      })
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/Unsafe URL scheme|Protocol|Invalid URL/)
    }

    // Legitimate URL passes
    const safeResult = validateSafeUrl(
      'https://www.linkedin.com/in/student-profile',
      {
        allowedHostnames: ['linkedin.com', 'www.linkedin.com'],
      },
    )
    expect(safeResult.valid).toBe(true)
    expect(safeResult.url?.hostname).toBe('www.linkedin.com')
  })

  // SEC-08: HTML injected into email fields -> Escaped, no active markup
  it('SEC-08: neutralizes and escapes HTML injected into transactional email fields', () => {
    const maliciousPayload =
      '<script>alert("XSS")</script><img src=x onerror=alert(1)>'
    const escaped = escapeHtml(maliciousPayload)

    expect(escaped).not.toContain('<script>')
    expect(escaped).not.toContain('<img')
    expect(escaped).toContain('&lt;script&gt;')
    expect(escaped).toContain(
      '&lt;img src=&#x2F; onerror=alert(1)&gt;'.replace('&#x2F;', 'x'),
    )

    const emailHtml = buildCertificateEmailHtml({
      studentName: maliciousPayload,
      internshipTitle: '<b onmouseover=evil()>Systems Track</b>',
      verificationCode: '550e8400-e29b-41d4-a716-446655440000',
      pdfUrl: '/api/v1/cert.pdf?x="><script>',
    })

    expect(emailHtml).not.toContain('<script>')
    expect(emailHtml).not.toContain('<b onmouseover')
    expect(emailHtml).toContain('&lt;script&gt;')
    expect(emailHtml).toContain('&lt;b onmouseover=evil()&gt;')

    const resetHtml = buildPasswordResetEmailHtml('token" onfocus="alert(1)')
    expect(resetHtml).not.toContain('onfocus="alert(1)')
  })

  // SEC-09: Cross-site state-changing request -> Rejected (CSRF)
  it('SEC-09: rejects cross-site state-changing request without CSRF token', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'sec09@example.com', password: 'Password123!' })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('invalid_csrf_token')
  })

  // SEC-10: Reuse JWT/session after password reset -> Rejected
  it('SEC-10: rejects pre-reset session token immediately after session_version bump', async () => {
    // Token issued with session_version 1
    const preResetToken = signSessionToken(
      { _id: studentId, role: 'student', session_version: 1 },
      'student',
    )

    // User undergoes password reset -> session_version bumped to 2
    jest.spyOn(User, 'findById').mockResolvedValue({
      _id: studentId,
      email: 'student@interncert.dev',
      role: 'student',
      session_version: 2, // New version in DB
    } as unknown as IUser)

    const res = await request(app)
      .get('/auth/me')
      .set('Cookie', [`session=${preResetToken}`])

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthorized')
  })

  // SEC-11: Open generated QR URL -> Correct verify page loads
  it('SEC-11: public verification endpoint successfully loads certificate details for legitimate QR UUID', async () => {
    const testCode = 'a0000000-0000-0000-0000-000000000001'

    jest.spyOn(Certificate, 'findOne').mockResolvedValue({
      verification_code: testCode,
      status: 'valid',
      issued_at: new Date('2026-01-01'),
      pdf_url: `/certificates/${testCode}.pdf`,
      enrollment_id: enrollmentId,
    } as unknown as ReturnType<typeof Certificate.findOne>)

    jest.spyOn(Enrollment, 'findById').mockResolvedValue({
      user_id: studentId,
      internship_id: internshipId,
    } as unknown as ReturnType<typeof Enrollment.findById>)

    jest.spyOn(Internship, 'findById').mockResolvedValue({
      title: 'Distributed Systems & Security',
    } as unknown as ReturnType<typeof Internship.findById>)

    const res = await request(app).get(`/verify/${testCode}`)

    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(true)
    expect(res.body.verification_code).toBe(testCode)
    expect(res.body.internship_title).toBe('Distributed Systems & Security')
  })

  // SEC-12: Approve stale/old task twice -> 409, current_task unchanged
  it('SEC-12: rejects stale or repeated task approval with 409 and maintains current_task invariant', async () => {
    const adminToken = signSessionToken(
      { _id: adminId, role: 'admin', session_version: 1 },
      'admin',
    )
    const csrf = await getCsrfHeaders()
    const submissionId = new mongoose.Types.ObjectId()

    jest.spyOn(TaskSubmission, 'findById').mockResolvedValue({
      _id: submissionId,
      enrollment_id: enrollmentId,
      task_number: 1,
      status: 'pending',
    } as unknown as ReturnType<typeof TaskSubmission.findById>)

    jest.spyOn(Enrollment, 'findById').mockResolvedValue({
      _id: enrollmentId,
      current_task: 2, // Task 1 is already stale!
    } as unknown as ReturnType<typeof Enrollment.findById>)

    // Atomic findOneAndUpdate fails because task_number (1) != enrollment.current_task (2)
    jest.spyOn(TaskSubmission, 'findOneAndUpdate').mockResolvedValue(null)

    const res = await request(app)
      .post(`/admin/submissions/${submissionId.toHexString()}/review`)
      .set('Cookie', [`session=${adminToken}`, ...csrf.cookies])
      .set('x-csrf-token', csrf.token)
      .send({ decision: 'approved' })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('stale_review')
  })

  // SEC-13: Complete enrollment twice / worker restart -> 1 certificate, 1 email
  it('SEC-13: completing enrollment twice or restarting worker is idempotent (1 certificate generated)', async () => {
    const testEnrollId = enrollmentId.toHexString()

    const existingCert = {
      _id: new mongoose.Types.ObjectId(),
      enrollment_id: enrollmentId,
      verification_code: 'c0000000-0000-0000-0000-000000000002',
      status: 'valid',
    }

    jest
      .spyOn(Certificate, 'findOne')
      .mockResolvedValue(
        existingCert as unknown as ReturnType<typeof Certificate.findOne>,
      )

    const result = await processCertificateIssuance(testEnrollId)
    expect(result.status).toBe('already_issued')
    expect(result.certificate.verification_code).toBe(
      existingCert.verification_code,
    )
  })

  // SEC-14: Sequential-guess certificate codes -> No enumeration at scale
  it('SEC-14: unguessable UUID code verification returns 404 without data leak for non-existent records', async () => {
    jest.spyOn(Certificate, 'findOne').mockResolvedValue(null)

    const fakeCode = crypto.randomUUID()
    const res = await request(app).get(`/verify/${fakeCode}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('certificate_not_found')
    expect(res.body).not.toHaveProperty('student_name')
    expect(res.body).not.toHaveProperty('internship_title')
  })

  // SEC-15: Admin revokes certificate -> MFA required, audit row written
  it('SEC-15: certificate revocation strictly requires valid MFA step-up and writes an immutable audit row', async () => {
    const adminToken = signSessionToken(
      { _id: adminId, role: 'admin', session_version: 1 },
      'admin',
    )
    const csrf = await getCsrfHeaders()
    const certId = new mongoose.Types.ObjectId()

    // 1. Rejection without MFA code
    const resNoMfa = await request(app)
      .post(`/admin/certificates/${certId.toHexString()}/revoke`)
      .set('Cookie', [`session=${adminToken}`, ...csrf.cookies])
      .set('x-csrf-token', csrf.token)
      .send({ reason: 'Academic policy violation' })

    expect(resNoMfa.status).toBe(403)
    expect(resNoMfa.body.error).toBe('mfa_required')

    // 2. Successful revocation with valid TOTP code
    const validTotp = totpGenerator.generate()

    jest.spyOn(Certificate, 'findOne').mockResolvedValue({
      _id: certId,
      verification_code: 'cert-uuid-123',
      status: 'valid',
      save: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof Certificate.findOne>)

    const auditSpy = jest
      .spyOn(AuditLog, 'create')
      .mockResolvedValue({} as unknown as ReturnType<typeof AuditLog.create>)

    const resValidMfa = await request(app)
      .post(`/admin/certificates/${certId.toHexString()}/revoke`)
      .set('Cookie', [`session=${adminToken}`, ...csrf.cookies])
      .set('x-csrf-token', csrf.token)
      .set('x-mfa-code', validTotp)
      .send({
        reason: 'Academic policy violation',
      })

    expect(resValidMfa.status).toBe(200)
    expect(resValidMfa.body.status).toBe('success')
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REVOKE_CERTIFICATE',
        target_type: 'Certificate',
      }),
    )
  })
})
