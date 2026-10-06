import { Router } from 'express'
import {
  reviewSubmission,
  getPendingSubmissions,
  issueCertificateForEnrollment,
  setupMfa,
  verifyMfa,
  revokeCertificate,
  refundPayment,
  getAuditLogs,
  getCertificates,
} from '../controllers/adminController.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { csrfProtection } from '../middleware/csrf.js'
import { requireMfaStepUp } from '../middleware/mfa.js'
import {
  createInternship,
  updateInternship,
} from '../controllers/internshipController.js'

export const adminRouter = Router()

// All admin routes require authentication and admin role
adminRouter.use(authenticate, requireRole('admin'))

// Submissions review
adminRouter.get('/submissions/pending', getPendingSubmissions)
adminRouter.post('/submissions/:id/review', csrfProtection, reviewSubmission)

// Manual certificate issuance
adminRouter.post(
  '/enrollments/:id/issue-certificate',
  csrfProtection,
  issueCertificateForEnrollment,
)

// MFA Enrollment & Verification
adminRouter.post('/mfa/setup', csrfProtection, setupMfa)
adminRouter.post('/mfa/verify', csrfProtection, verifyMfa)

// High-Risk Endpoints (SEC-15: Requires MFA Step-Up + CSRF Protection)
adminRouter.post(
  '/certificates/:id/revoke',
  csrfProtection,
  requireMfaStepUp,
  revokeCertificate,
)

adminRouter.post(
  '/payments/:id/refund',
  csrfProtection,
  requireMfaStepUp,
  refundPayment,
)

// Paginated admin telemetry & listings
adminRouter.get('/audit-logs', getAuditLogs)
adminRouter.get('/certificates', getCertificates)

// Internship Management CRUD
adminRouter.post('/internships', csrfProtection, createInternship)
adminRouter.put('/internships/:id', csrfProtection, updateInternship)
