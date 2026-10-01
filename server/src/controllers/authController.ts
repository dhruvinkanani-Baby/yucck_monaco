import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import argon2 from 'argon2'
import { User, type IUser } from '../models/User.js'
import {
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from '../middleware/auth.js'
import { issueCsrfToken, clearCsrfToken } from '../middleware/csrf.js'
import { sendPasswordResetEmail } from '../services/email.js'
import type { UserPublic } from '@interncert/types'

const registerSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z.string().min(8).max(100),
})

const loginSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z.string().min(1).max(100),
})

const forgotPasswordSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
})

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(100),
})

function formatUserPublic(user: IUser): UserPublic {
  return {
    id: String(user._id),
    email: user.email,
    role: user.role,
    session_version: user.session_version,
    created_at: user.createdAt.toISOString(),
  }
}

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parseResult = registerSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { email, password } = parseResult.data

    const existing = await User.findOne({ email })
    if (existing) {
      res.status(409).json({ error: 'email_already_registered' })
      return
    }

    const password_hash = await argon2.hash(password)
    const user = await User.create({
      email,
      password_hash,
      role: 'student',
      session_version: 1,
    })

    const token = signSessionToken(user, user.role)
    setSessionCookie(res, token, user.role)
    issueCsrfToken(res)

    res.status(201).json({ user: formatUserPublic(user) })
  } catch (err) {
    next(err)
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parseResult = loginSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { email, password } = parseResult.data

    const user = await User.findOne({ email })
    if (!user) {
      res.status(401).json({ error: 'invalid_credentials' })
      return
    }

    const valid = await argon2.verify(user.password_hash, password)
    if (!valid) {
      res.status(401).json({ error: 'invalid_credentials' })
      return
    }

    const token = signSessionToken(user, user.role)
    setSessionCookie(res, token, user.role)
    issueCsrfToken(res)

    res.status(200).json({ user: formatUserPublic(user) })
  } catch (err) {
    next(err)
  }
}

export function logout(_req: Request, res: Response): void {
  clearSessionCookie(res)
  clearCsrfToken(res)
  res.status(200).json({ status: 'ok' })
}

export function getMe(req: Request, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  res.status(200).json({ user: formatUserPublic(req.user) })
}

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parseResult = forgotPasswordSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { email } = parseResult.data
    const user = await User.findOne({ email })

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex')

      user.reset_password_token_hash = tokenHash
      user.reset_password_expires_at = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      await user.save()

      await sendPasswordResetEmail({ to: user.email, rawToken })
    }

    // Generic response regardless of whether user exists to prevent email enumeration
    res.status(200).json({
      status: 'ok',
      message:
        'If an account matches that email, a password reset link has been dispatched.',
    })
  } catch (err) {
    next(err)
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parseResult = resetPasswordSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { token, password } = parseResult.data
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const user = await User.findOne({
      reset_password_token_hash: tokenHash,
      reset_password_expires_at: { $gt: new Date() },
    })

    if (!user) {
      res.status(400).json({ error: 'invalid_or_expired_token' })
      return
    }

    user.password_hash = await argon2.hash(password)
    // Invalidate all existing sessions (audit SEC-10)
    user.session_version += 1
    user.reset_password_token_hash = null
    user.reset_password_expires_at = null
    await user.save()

    clearSessionCookie(res)
    clearCsrfToken(res)

    res.status(200).json({
      status: 'ok',
      message:
        'Password reset successful. Please log in with your new password.',
    })
  } catch (err) {
    next(err)
  }
}
