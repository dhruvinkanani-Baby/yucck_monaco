import { Router } from 'express'
import {
  reviewSubmission,
  getPendingSubmissions,
  issueCertificateForEnrollment,
} from '../controllers/adminController.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { csrfProtection } from '../middleware/csrf.js'

export const adminRouter = Router()

// All admin routes require authentication and admin role
adminRouter.use(authenticate, requireRole('admin'))

adminRouter.get('/submissions/pending', getPendingSubmissions)
adminRouter.post('/submissions/:id/review', csrfProtection, reviewSubmission)
adminRouter.post(
  '/enrollments/:id/issue-certificate',
  csrfProtection,
  issueCertificateForEnrollment,
)
