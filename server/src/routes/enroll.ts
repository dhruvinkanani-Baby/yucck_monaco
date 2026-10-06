import { Router } from 'express'
import {
  createEnrollmentOrder,
  verifyEnrollmentPayment,
  getMyEnrollments,
} from '../controllers/enrollController.js'
import { authenticate } from '../middleware/auth.js'
import { csrfProtection } from '../middleware/csrf.js'

export const enrollRouter = Router()

enrollRouter.get('/my', authenticate, getMyEnrollments)
enrollRouter.post('/order', authenticate, csrfProtection, createEnrollmentOrder)
enrollRouter.post(
  '/verify',
  authenticate,
  csrfProtection,
  verifyEnrollmentPayment,
)
