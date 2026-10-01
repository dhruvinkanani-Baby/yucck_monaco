import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import argon2 from 'argon2'
import mongoose from 'mongoose'
import crypto from 'node:crypto'
import { app } from '../app.js'
import { User, type IUser } from '../models/User.js'

describe('Step 3 — Auth & Sessions Security Gates (SEC-09, SEC-10)', () => {
  interface MockUserRecord {
    _id: mongoose.Types.ObjectId
    email: string
    password_hash: string
    role: 'student' | 'admin'
    session_version: number
    reset_password_token_hash?: string | null
    reset_password_expires_at?: Date | null
    createdAt: Date
    updatedAt: Date
    save: () => Promise<MockUserRecord>
  }

  const usersStore = new Map<string, MockUserRecord>()

  function createMockUser(data: Partial<MockUserRecord>): MockUserRecord {
    const id = data._id || new mongoose.Types.ObjectId()
    const doc: MockUserRecord = {
      _id: id,
      email: data.email || 'test@example.com',
      password_hash: data.password_hash || '',
      role: data.role || 'student',
      session_version: data.session_version ?? 1,
      reset_password_token_hash: data.reset_password_token_hash || null,
      reset_password_expires_at: data.reset_password_expires_at || null,
      createdAt: data.createdAt || new Date(),
      updatedAt: data.updatedAt || new Date(),
      save: async function () {
        usersStore.set(this._id.toString(), this)
        return this
      },
    }
    usersStore.set(id.toString(), doc)
    return doc
  }

  beforeEach(() => {
    usersStore.clear()

    jest.spyOn(User, 'findOne').mockImplementation((query: unknown) => {
      const q = query as Record<string, unknown>
      for (const user of usersStore.values()) {
        if (q.email && user.email === q.email) {
          return Promise.resolve(user as unknown as IUser)
        }
        if (
          q.reset_password_token_hash &&
          user.reset_password_token_hash === q.reset_password_token_hash
        ) {
          const expires = user.reset_password_expires_at
          if (expires && expires > new Date()) {
            return Promise.resolve(user as unknown as IUser)
          }
        }
      }
      return Promise.resolve(null)
    })

    jest.spyOn(User, 'findById').mockImplementation((id: unknown) => {
      const strId = String(id)
      const user = usersStore.get(strId)
      return Promise.resolve(user ? (user as unknown as IUser) : null)
    })

    jest.spyOn(User, 'create').mockImplementation((data: unknown) => {
      const doc = createMockUser(data as Partial<MockUserRecord>)
      return Promise.resolve(doc as unknown as IUser)
    })
  })

  it('SEC-09: rejects cross-site state-changing request without CSRF token', async () => {
    // Attempt to register without CSRF token
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'sec09@example.com', password: 'Password123!' })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('invalid_csrf_token')
  })

  it('registers a user with CSRF token, hashes password with Argon2, issues HttpOnly cookie, returns no token in body', async () => {
    // 1. Get CSRF token
    const csrfRes = await request(app).get('/auth/csrf')
    expect(csrfRes.status).toBe(200)
    const csrfToken = csrfRes.body.csrf_token
    const csrfCookie = csrfRes.headers['set-cookie']

    // 2. Perform register
    const res = await request(app)
      .post('/auth/register')
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        email: 'student@example.com',
        password: 'SuperSecurePassword123',
      })

    expect(res.status).toBe(201)
    expect(res.body.user).toBeDefined()
    expect(res.body.user.email).toBe('student@example.com')
    // No token in JSON response body
    expect(res.body.token).toBeUndefined()
    expect(res.body.jwt).toBeUndefined()

    // HttpOnly session cookie present
    const setCookie = res.headers['set-cookie'] as string[] | undefined
    expect(setCookie).toBeDefined()
    const sessionCookieStr = setCookie?.find((c) => c.startsWith('session='))
    expect(sessionCookieStr).toBeDefined()
    expect(sessionCookieStr).toContain('HttpOnly')

    // Verify password was hashed with Argon2
    const created = Array.from(usersStore.values())[0]
    expect(created).toBeDefined()
    expect(created.password_hash).toMatch(/^\$argon2/)
    expect(
      await argon2.verify(created.password_hash, 'SuperSecurePassword123'),
    ).toBe(true)
  })

  it('authenticates user via session cookie on GET /auth/me', async () => {
    const passwordHash = await argon2.hash('SecretPass123')
    const user = createMockUser({
      email: 'me@example.com',
      password_hash: passwordHash,
      role: 'student',
    })

    // Log in
    const csrfRes = await request(app).get('/auth/csrf')
    const csrfToken = csrfRes.body.csrf_token
    const csrfCookie = csrfRes.headers['set-cookie']

    const loginRes = await request(app)
      .post('/auth/login')
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send({ email: 'me@example.com', password: 'SecretPass123' })

    expect(loginRes.status).toBe(200)
    const sessionCookie = loginRes.headers['set-cookie']

    // Call /auth/me with session cookie
    const meRes = await request(app)
      .get('/auth/me')
      .set('Cookie', sessionCookie)

    expect(meRes.status).toBe(200)
    expect(meRes.body.user.id).toBe(user._id.toString())
    expect(meRes.body.user.email).toBe('me@example.com')
  })

  it('forgot-password returns generic 200 response to prevent account enumeration', async () => {
    const csrfRes = await request(app).get('/auth/csrf')
    const csrfToken = csrfRes.body.csrf_token
    const csrfCookie = csrfRes.headers['set-cookie']

    // Non-existent user
    const res = await request(app)
      .post('/auth/forgot-password')
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send({ email: 'nonexistent@example.com' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.message).toContain('If an account matches')
  })

  it('SEC-10: invalidates pre-reset session cookie after password reset (session_version bump)', async () => {
    // 1. Create user and log in to get session cookie
    const passwordHash = await argon2.hash('InitialPassword123')
    const user = createMockUser({
      email: 'victim@example.com',
      password_hash: passwordHash,
      session_version: 1,
    })

    const csrfRes = await request(app).get('/auth/csrf')
    const csrfToken = csrfRes.body.csrf_token
    const csrfCookie = csrfRes.headers['set-cookie']

    const loginRes = await request(app)
      .post('/auth/login')
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send({ email: 'victim@example.com', password: 'InitialPassword123' })

    expect(loginRes.status).toBe(200)
    const initialSessionCookie = loginRes.headers['set-cookie']

    // Verify session works initially
    const preCheck = await request(app)
      .get('/auth/me')
      .set('Cookie', initialSessionCookie)
    expect(preCheck.status).toBe(200)

    // 2. Request forgot-password to generate token
    await request(app)
      .post('/auth/forgot-password')
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send({ email: 'victim@example.com' })

    // Simulate raw token matching the sha256 hash in user record
    const rawResetToken = 'test-raw-token-abcdef1234567890'
    user.reset_password_token_hash = crypto
      .createHash('sha256')
      .update(rawResetToken)
      .digest('hex')
    user.reset_password_expires_at = new Date(Date.now() + 3600000)

    // 3. Reset password using the token
    const resetRes = await request(app)
      .post('/auth/reset-password')
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send({ token: rawResetToken, password: 'NewPassword999!' })

    expect(resetRes.status).toBe(200)
    expect(user.session_version).toBe(2)

    // 4. SEC-10 check: Reuse the pre-reset session cookie -> MUST BE REJECTED (401)
    const postResetAttempt = await request(app)
      .get('/auth/me')
      .set('Cookie', initialSessionCookie)

    expect(postResetAttempt.status).toBe(401)
    expect(postResetAttempt.body.error).toBe('unauthorized')
  })
})
