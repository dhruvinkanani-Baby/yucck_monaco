import { describe, it, expect } from '@jest/globals'
import request from 'supertest'
import { app } from './app.js'
import { env } from './config/env.js'

describe('Step 2 — Baseline app and middleware', () => {
  it('serves /health with 200 ok and propagates x-request-id', async () => {
    const res = await request(app)
      .get('/health')
      .set('x-request-id', 'test-req-123')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.headers['x-request-id']).toBe('test-req-123')
  })

  it('generates a uuid for x-request-id if not provided', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.headers['x-request-id']).toBeDefined()
    expect(res.headers['x-request-id'].length).toBeGreaterThan(10)
  })

  it('sets security headers via helmet', async () => {
    const res = await request(app).get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
  })

  it('configures strict CORS matching env.FRONTEND_URL with credentials', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', env.FRONTEND_URL)
    expect(res.headers['access-control-allow-origin']).toBe(env.FRONTEND_URL)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('rejects JSON payloads larger than 100kb with 413 Payload Too Large', async () => {
    const largeData = 'x'.repeat(101 * 1024)
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ large: largeData }))
    expect(res.status).toBe(413)
  })

  it('configures trust proxy explicitly rather than a bare 1', () => {
    const trustProxy = app.get('trust proxy')
    expect(trustProxy).not.toBe(1)
    expect(trustProxy).not.toBe(true)
  })

  it('returns generic { error: "internal_error", requestId } and hides stack/message on 500', async () => {
    const res = await request(app)
      .get('/test-error')
      .set('x-request-id', 'err-req-999')

    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      error: 'internal_error',
      requestId: 'err-req-999',
    })
    expect(JSON.stringify(res.body)).not.toContain(
      'Sensitive database credentials',
    )
  })
})
