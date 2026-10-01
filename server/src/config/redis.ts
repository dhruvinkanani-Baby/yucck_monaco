import { Redis } from 'ioredis'
import { env } from './env.js'
import { logger } from './logger.js'

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: true,
  lazyConnect: env.NODE_ENV === 'test',
  tls: env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
  retryStrategy(times) {
    if (env.NODE_ENV === 'test') {
      return null
    }
    const delay = Math.min(times * 100, 3000)
    logger.warn({ times, delay }, 'Redis reconnecting...')
    return delay
  },
})

redis.on('connect', () => {
  logger.info('Redis client connected')
})

redis.on('error', (err) => {
  if (env.NODE_ENV !== 'test') {
    logger.error({ err }, 'Redis client error')
  }
})

export async function closeRedis(): Promise<void> {
  if (redis.status !== 'end') {
    await redis.quit()
    logger.info('Redis connection closed')
  }
}
