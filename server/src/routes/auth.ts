import { Router, type Request, type Response } from 'express'
import {
  register,
  login,
  logout,
  getMe,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js'
import { authenticate } from '../middleware/auth.js'
import { csrfProtection, issueCsrfToken } from '../middleware/csrf.js'
import { loginLimiter, resetLimiter } from '../middleware/rateLimiter.js'

export const authRouter = Router()

// Handshake endpoint to issue CSRF token for initial app load
authRouter.get('/csrf', (_req: Request, res: Response) => {
  const token = issueCsrfToken(res)
  res.status(200).json({ csrf_token: token })
})

authRouter.post('/register', loginLimiter, csrfProtection, register)
authRouter.post('/login', loginLimiter, csrfProtection, login)
authRouter.post('/logout', csrfProtection, logout)
authRouter.get('/me', authenticate, getMe)
authRouter.post(
  '/forgot-password',
  resetLimiter,
  csrfProtection,
  forgotPassword,
)
authRouter.post('/reset-password', resetLimiter, csrfProtection, resetPassword)
