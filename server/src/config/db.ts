import mongoose from 'mongoose'
import { env } from './env.js'
import { logger } from './logger.js'

interface ConnectOptions {
  maxRetries?: number
  initialDelayMs?: number
}

export async function connectDB(
  options: ConnectOptions = {},
): Promise<typeof mongoose> {
  const maxRetries = options.maxRetries ?? (env.NODE_ENV === 'test' ? 1 : 5)
  const initialDelayMs = options.initialDelayMs ?? 1000

  let attempt = 0
  while (attempt < maxRetries) {
    try {
      attempt++
      const conn = await mongoose.connect(env.MONGO_URI, {
        tls:
          env.NODE_ENV === 'production' ||
          env.MONGO_URI.includes('tls=true') ||
          env.MONGO_URI.startsWith('mongodb+srv://')
            ? true
            : undefined,
        serverSelectionTimeoutMS: 5000,
      })
      logger.info(
        { host: conn.connection.host, attempt },
        'Connected to MongoDB',
      )
      return conn
    } catch (err) {
      logger.error(
        { err, attempt, maxRetries },
        'MongoDB connection attempt failed',
      )
      if (attempt >= maxRetries) {
        throw err
      }
      const delay = initialDelayMs * Math.pow(2, attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw new Error('Failed to connect to MongoDB after maximum retries')
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
    logger.info('Disconnected from MongoDB')
  }
}
