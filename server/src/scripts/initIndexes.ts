import { connectDB, disconnectDB } from '../config/db.js'
import { initAllIndexes } from '../models/initIndexes.js'
import { logger } from '../config/logger.js'

async function run() {
  try {
    logger.info('Starting manual index initialization script...')
    await connectDB()
    await initAllIndexes()
    await disconnectDB()
    logger.info('Index initialization script completed successfully.')
    process.exit(0)
  } catch (err) {
    logger.fatal({ err }, 'Error executing index initialization script')
    process.exit(1)
  }
}

void run()
