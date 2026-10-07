import { Router } from 'express'
import {
  verifyCertificate,
  downloadCertificatePdf,
} from '../controllers/verifyController.js'
import { verifyLimiter } from '../middleware/rateLimiter.js'

export const verifyRouter = Router()

// Public route protected by rate limiter against enumeration attacks (SEC-14)
verifyRouter.use(verifyLimiter)

verifyRouter.get('/:code', verifyCertificate)
verifyRouter.get('/:code/pdf', downloadCertificatePdf)
