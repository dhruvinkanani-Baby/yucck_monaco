import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import crypto from 'node:crypto'
import { app } from '../app.js'
import { User, type IUser } from '../models/User.js'
import { Internship, type IInternship } from '../models/Internship.js'
import { Enrollment, type IEnrollment } from '../models/Enrollment.js'
import { Payment, type IPayment } from '../models/Payment.js'
import { WebhookEvent, type IWebhookEvent } from '../models/WebhookEvent.js'
import { razorpayService } from '../services/razorpay.js'
import { signSessionToken } from '../middleware/auth.js'
import { env } from '../config/env.js'

describe('Step 5 — Payment & Enrollment Flow (SEC-01 to SEC-06)', () => {
  interface MockUser {
    _id: mongoose.Types.ObjectId
    email: string
    role: 'student' | 'admin'
    session_version: number
  }

  interface MockInternship {
    _id: mongoose.Types.ObjectId
    title: string
    description: string
    price: number
    currency: string
    is_active: boolean
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
    status: 'active' | 'expired' | 'closed'
    current_task: number
  }

  interface MockPayment {
    _id: mongoose.Types.ObjectId
    user_id: mongoose.Types.ObjectId
    internship_id: mongoose.Types.ObjectId
    razorpay_order_id: string
    razorpay_payment_id?: string
    amount: number
    currency: string
    status: string
    save: () => Promise<MockPayment>
  }

  interface MockWebhookEvent {
    _id: mongoose.Types.ObjectId
    event_id: string
    event: string
    payload: Record<string, unknown>
  }

  const usersStore = new Map<string, MockUser>()
  const internshipsStore = new Map<string, MockInternship>()
  const enrollmentsStore = new Map<string, MockEnrollment>()
  const paymentsStore = new Map<string, MockPayment>()
  const webhookEventsStore = new Map<string, MockWebhookEvent>()

  const userAId = new mongoose.Types.ObjectId()
  const userBId = new mongoose.Types.ObjectId()
  const internshipId = new mongoose.Types.ObjectId()

  function getAuthHeader(
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
    usersStore.clear()
    internshipsStore.clear()
    enrollmentsStore.clear()
    paymentsStore.clear()
    webhookEventsStore.clear()

    // Seed test users
    usersStore.set(userAId.toString(), {
      _id: userAId,
      email: 'student_a@example.com',
      role: 'student',
      session_version: 1,
    })
    usersStore.set(userBId.toString(), {
      _id: userBId,
      email: 'student_b@example.com',
      role: 'student',
      session_version: 1,
    })

    // Seed active internship
    internshipsStore.set(internshipId.toString(), {
      _id: internshipId,
      title: 'Backend Engineering',
      description: 'Hands on',
      price: 499900,
      currency: 'INR',
      is_active: true,
      tasks: [
        {
          task_number: 1,
          title: 'Task 1',
          description: 'Desc',
          deadline_days: 7,
        },
      ],
    })

    // Spies on User
    jest.spyOn(User, 'findById').mockImplementation((id: unknown) => {
      const u = usersStore.get(String(id))
      return Promise.resolve(u as unknown as IUser)
    })

    // Spies on Internship
    jest.spyOn(Internship, 'findById').mockImplementation((id: unknown) => {
      const i = internshipsStore.get(String(id))
      return {
        session: () => Promise.resolve(i as unknown as IInternship),
        ...i,
      } as unknown as mongoose.Query<IInternship | null, IInternship>
    })

    // Spies on Enrollment
    jest.spyOn(Enrollment, 'findOne').mockImplementation((query: unknown) => {
      const q = query as Record<string, unknown>
      for (const e of enrollmentsStore.values()) {
        if (
          String(e.user_id) === String(q.user_id) &&
          String(e.internship_id) === String(q.internship_id) &&
          (!q.status || e.status === q.status)
        ) {
          return Promise.resolve(e as unknown as IEnrollment)
        }
      }
      return Promise.resolve(null)
    })

    jest.spyOn(Enrollment, 'create').mockImplementation((data: unknown) => {
      const items = Array.isArray(data) ? data : [data]
      const created = items.map((item) => {
        const id = new mongoose.Types.ObjectId()
        const doc = { _id: id, ...(item as object) } as MockEnrollment
        enrollmentsStore.set(id.toString(), doc)
        return doc
      })
      return Promise.resolve(
        Array.isArray(data) ? created : created[0],
      ) as unknown as Promise<IEnrollment>
    })

    // Spies on Payment
    jest.spyOn(Payment, 'findOne').mockImplementation((query: unknown) => {
      const q = query as Record<string, unknown>
      for (const p of paymentsStore.values()) {
        const matchOrderId =
          !q.razorpay_order_id || p.razorpay_order_id === q.razorpay_order_id
        const matchUser = !q.user_id || String(p.user_id) === String(q.user_id)
        if (matchOrderId && matchUser) {
          p.save = async function () {
            paymentsStore.set(this._id.toString(), this)
            return this
          }
          return Promise.resolve(p as unknown as IPayment)
        }
      }
      return Promise.resolve(null)
    })

    jest.spyOn(Payment, 'create').mockImplementation((data: unknown) => {
      const id = new mongoose.Types.ObjectId()
      const doc: MockPayment = {
        _id: id,
        ...(data as object as Omit<MockPayment, '_id' | 'save'>),
        save: async function () {
          paymentsStore.set(this._id.toString(), this)
          return this
        },
      }
      paymentsStore.set(id.toString(), doc)
      return Promise.resolve(doc as unknown as IPayment)
    })

    // Spies on WebhookEvent
    jest.spyOn(WebhookEvent, 'create').mockImplementation((data: unknown) => {
      const d = data as { event_id: string }
      const id = new mongoose.Types.ObjectId()
      const doc: MockWebhookEvent = {
        _id: id,
        ...(data as object as Omit<MockWebhookEvent, '_id'>),
      }
      webhookEventsStore.set(d.event_id, doc)
      return Promise.resolve(doc as unknown as IWebhookEvent)
    })
  })

  it('SEC-01: environment refuses to boot without Razorpay secrets in production', async () => {
    const { envSchema } = await import('../config/env.js')
    const result = envSchema.safeParse({
      NODE_ENV: 'production',
      PORT: '4000',
      MONGO_URI: 'mongodb://localhost:27017/db',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'min-thirty-two-character-secret-key-prod',
      COOKIE_SECRET: 'min-thirty-two-character-cookie-sec-prod',
      FRONTEND_URL: 'https://example.com',
      RAZORPAY_KEY_ID: '', // missing
      RAZORPAY_KEY_SECRET: '', // missing
      RAZORPAY_WEBHOOK_SECRET: 'webhook_secret',
      RESEND_API_KEY: 'resend_key',
      CLOUD_STORAGE_KEY: 'storage_key',
    })

    expect(result.success).toBe(false)
  })

  it('SEC-02: dev/mock endpoints are absent and return 404 in non-test paths', async () => {
    const res = await request(app).get('/mock/razorpay/payments')
    expect(res.status).toBe(404)
  })

  it('creates an enrollment order via POST /enroll/order and registers created Payment record', async () => {
    // 1. Handshake CSRF token
    const csrfRes = await request(app).get('/auth/csrf')
    const csrfToken = csrfRes.body.csrf_token
    const csrfCookie = csrfRes.headers['set-cookie']

    jest.spyOn(razorpayService, 'createOrder').mockResolvedValueOnce({
      id: 'order_test_123',
      amount: 499900,
      currency: 'INR',
      status: 'created',
    })

    const res = await request(app)
      .post('/enroll/order')
      .set('Cookie', [getAuthHeader(userAId), ...csrfCookie])
      .set('x-csrf-token', csrfToken)
      .send({ internship_id: internshipId.toString() })

    expect(res.status).toBe(201)
    expect(res.body.order_id).toBe('order_test_123')
    expect(res.body.amount).toBe(499900)

    const paymentRecord = Array.from(paymentsStore.values())[0]
    expect(paymentRecord).toBeDefined()
    expect(paymentRecord.razorpay_order_id).toBe('order_test_123')
    expect(paymentRecord.status).toBe('created')
  })

  it('rejects POST /enroll/order with 409 if active enrollment already exists', async () => {
    // Seed existing active enrollment
    enrollmentsStore.set('existing_active', {
      _id: new mongoose.Types.ObjectId(),
      user_id: userAId,
      internship_id: internshipId,
      status: 'active',
      current_task: 1,
    })

    const csrfRes = await request(app).get('/auth/csrf')
    const csrfToken = csrfRes.body.csrf_token
    const csrfCookie = csrfRes.headers['set-cookie']

    const res = await request(app)
      .post('/enroll/order')
      .set('Cookie', [getAuthHeader(userAId), ...csrfCookie])
      .set('x-csrf-token', csrfToken)
      .send({ internship_id: internshipId.toString() })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('active_enrollment_exists')
  })

  it('SEC-03: rejects payment verification using another user order ID pre-mutation (403 forbidden)', async () => {
    // User A created the payment order
    const paymentId = new mongoose.Types.ObjectId()
    paymentsStore.set(paymentId.toString(), {
      _id: paymentId,
      user_id: userAId,
      internship_id: internshipId,
      razorpay_order_id: 'order_user_a',
      amount: 499900,
      currency: 'INR',
      status: 'created',
    })

    const csrfRes = await request(app).get('/auth/csrf')
    const csrfToken = csrfRes.body.csrf_token
    const csrfCookie = csrfRes.headers['set-cookie']

    // User B attempts to verify User A's order ID
    const res = await request(app)
      .post('/enroll/verify')
      .set('Cookie', [getAuthHeader(userBId), ...csrfCookie])
      .set('x-csrf-token', csrfToken)
      .send({
        razorpay_order_id: 'order_user_a',
        razorpay_payment_id: 'pay_xyz_123',
        razorpay_signature: 'sig_123',
      })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden')
  })

  it('SEC-04: replays of already paid verification are idempotent (returns existing enrollment)', async () => {
    const paymentId = new mongoose.Types.ObjectId()
    paymentsStore.set(paymentId.toString(), {
      _id: paymentId,
      user_id: userAId,
      internship_id: internshipId,
      razorpay_order_id: 'order_already_paid',
      amount: 499900,
      currency: 'INR',
      status: 'paid',
    })

    enrollmentsStore.set('existing_enrollment', {
      _id: new mongoose.Types.ObjectId(),
      user_id: userAId,
      internship_id: internshipId,
      status: 'active',
      current_task: 1,
    })

    const csrfRes = await request(app).get('/auth/csrf')
    const csrfToken = csrfRes.body.csrf_token
    const csrfCookie = csrfRes.headers['set-cookie']

    const res = await request(app)
      .post('/enroll/verify')
      .set('Cookie', [getAuthHeader(userAId), ...csrfCookie])
      .set('x-csrf-token', csrfToken)
      .send({
        razorpay_order_id: 'order_already_paid',
        razorpay_payment_id: 'pay_abc_999',
        razorpay_signature: 'sig_valid',
      })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('already_paid')
    expect(res.body.enrollment).toBeDefined()
  })

  it('SEC-05: rejects payment verification when valid signature has wrong amount (400)', async () => {
    const paymentId = new mongoose.Types.ObjectId()
    paymentsStore.set(paymentId.toString(), {
      _id: paymentId,
      user_id: userAId,
      internship_id: internshipId,
      razorpay_order_id: 'order_price_tamper',
      amount: 499900,
      currency: 'INR',
      status: 'created',
    })

    // Valid signature simulation
    jest
      .spyOn(razorpayService, 'verifyPaymentSignature')
      .mockReturnValueOnce(true)

    // Razorpay reports smaller amount (tampered)
    jest.spyOn(razorpayService, 'fetchPayment').mockResolvedValueOnce({
      id: 'pay_tampered',
      order_id: 'order_price_tamper',
      amount: 100, // 1 INR instead of 4999 INR
      currency: 'INR',
      status: 'captured',
    })

    const csrfRes = await request(app).get('/auth/csrf')
    const csrfToken = csrfRes.body.csrf_token
    const csrfCookie = csrfRes.headers['set-cookie']

    const res = await request(app)
      .post('/enroll/verify')
      .set('Cookie', [getAuthHeader(userAId), ...csrfCookie])
      .set('x-csrf-token', csrfToken)
      .send({
        razorpay_order_id: 'order_price_tamper',
        razorpay_payment_id: 'pay_tampered',
        razorpay_signature: 'valid_sig',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('payment_amount_mismatch')
  })

  it('SEC-06: reconciles state when browser closes after capture via POST /webhooks/razorpay', async () => {
    // Payment created but user closed browser before frontend could call /enroll/verify
    const paymentId = new mongoose.Types.ObjectId()
    const paymentRecord = {
      _id: paymentId,
      user_id: userAId,
      internship_id: internshipId,
      razorpay_order_id: 'order_browser_closed',
      amount: 499900,
      currency: 'INR',
      status: 'created',
      save: async function () {
        paymentsStore.set(this._id.toString(), this)
        return this
      },
    }
    paymentsStore.set(paymentId.toString(), paymentRecord)

    const webhookPayload = {
      event_id: 'evt_sec06_12345',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_captured',
            order_id: 'order_browser_closed',
            amount: 499900,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    }

    const payloadString = JSON.stringify(webhookPayload)
    const expectedSignature = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(Buffer.from(payloadString, 'utf8'))
      .digest('hex')

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', expectedSignature)
      .send(payloadString)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('processed')

    // Invariant check: Payment record reconciled to 'paid'
    expect(paymentRecord.status).toBe('paid')
    expect(paymentRecord.razorpay_payment_id).toBe('pay_webhook_captured')

    // Invariant check: Enrollment record created for user
    const createdEnrollment = Array.from(enrollmentsStore.values()).find(
      (e) =>
        String(e.user_id) === userAId.toString() &&
        String(e.internship_id) === internshipId.toString(),
    )
    expect(createdEnrollment).toBeDefined()
    expect(createdEnrollment.status).toBe('active')
  })
})
