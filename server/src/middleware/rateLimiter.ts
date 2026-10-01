import { rateLimit } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { redis } from '../config/redis.js'
import { env } from '../config/env.js'

function createStore(prefix: string) {
  if (env.NODE_ENV === 'test') {
    return undefined // Use in-memory store during unit/integration tests
  }
  return new RedisStore({
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<number | string | boolean>,
    prefix: `rl:${prefix}:`,
  })
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('login'),
  message: {
    error: 'too_many_requests',
    message: 'Too many login attempts. Please try again later.',
  },
})

export const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 3,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('reset'),
  message: {
    error: 'too_many_requests',
    message: 'Too many password reset requests. Please try again later.',
  },
})

export const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('verify'),
  message: {
    error: 'too_many_requests',
    message: 'Verification rate limit exceeded.',
  },
})

export const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('contact'),
  message: {
    error: 'too_many_requests',
    message: 'Contact message rate limit reached. Please try again later.',
  },
})

export const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('admin'),
  message: {
    error: 'too_many_requests',
    message: 'Admin rate limit exceeded.',
  },
})
