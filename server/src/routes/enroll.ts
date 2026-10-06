import { Router } from 'express'
import {
  createEnrollmentOrder,
  verifyEnrollmentPayment,
} from '../controllers/enrollController.js'
import { authenticate } from '../middleware/auth.js'
import { csrfProtection } from '../middleware/csrf.js'

export const enrollRouter = Router()

enrollRouter.post('/order', authenticate, csrfProtection, createEnrollmentOrder)
enrollRouter.post(
  '/verify',
  authenticate,
  csrfProtection,
  verifyEnrollmentPayment,
)
