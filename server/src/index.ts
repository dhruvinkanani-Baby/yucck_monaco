import { env } from './config/env.js'
import { app } from './app.js'
import { connectDB, disconnectDB } from './config/db.js'
import { redis, closeRedis } from './config/redis.js'
import { logger } from './config/logger.js'

async function bootstrap() {
  try {
    logger.info('Starting InternCert server bootstrap...')

    // Gate: Server boots, connects to Mongo + Redis, refuses to boot with bad/missing env
    await connectDB()
    await redis.ping()
    logger.info('Redis connection verified via ping')

    // In non-production, ensure all indexes are created explicitly at boot
    if (env.NODE_ENV !== 'production') {
      const { initAllIndexes } = await import('./models/initIndexes.js')
      await initAllIndexes()
    }

    const server = app.listen(env.PORT, () => {
      logger.info(
        `[interncert] server listening on port ${env.PORT} in ${env.NODE_ENV} mode`,
      )
    })

    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Graceful shutdown initiated')
      server.close(async () => {
        logger.info('HTTP server closed')
        await disconnectDB()
        await closeRedis()
        logger.info('All database connections closed. Exiting process.')
        process.exit(0)
      })

      setTimeout(() => {
        logger.error('Graceful shutdown timed out. Forcing exit.')
        process.exit(1)
      }, 10000).unref()
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  } catch (err) {
    logger.fatal({ err }, 'Fatal error during server startup')
    process.exit(1)
  }
}

void bootstrap()
