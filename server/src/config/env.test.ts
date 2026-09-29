import { describe, expect, it } from '@jest/globals'
import { env, envSchema } from './env.js'

const valid = {
  NODE_ENV: 'test',
  PORT: '4000',
  MONGO_URI: 'mongodb://localhost:27017/interncert',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'test-jwt-secret-must-be-32-chars-min',
  COOKIE_SECRET: 'test-cookie-secret-must-be-32-chars',
  FRONTEND_URL: 'http://localhost:5173',
  RAZORPAY_KEY_ID: 'rzp_test_ci',
  RAZORPAY_KEY_SECRET: 'ci_secret',
  RAZORPAY_WEBHOOK_SECRET: 'ci_webhook',
  RESEND_API_KEY: 're_ci',
  CLOUD_STORAGE_KEY: 'ci_storage',
}

describe('env schema (audit F22 fail-fast)', () => {
  it('parses a complete environment at boot', () => {
    expect(env.NODE_ENV).toBe('test')
    expect(env.PORT).toBe(4000)
  })

  it('accepts a complete environment object', () => {
    const result = envSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('rejects missing Razorpay secrets instead of implying mock mode (F01)', () => {
    const rest = Object.fromEntries(
      Object.entries(valid).filter(([key]) => key !== 'RAZORPAY_KEY_SECRET'),
    )
    expect(envSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects JWT_SECRET shorter than 32 characters', () => {
    expect(
      envSchema.safeParse({ ...valid, JWT_SECRET: 'too-short' }).success,
    ).toBe(false)
  })

  it('rejects an invalid NODE_ENV', () => {
    expect(envSchema.safeParse({ ...valid, NODE_ENV: 'staging' }).success).toBe(
      false,
    )
  })
})
