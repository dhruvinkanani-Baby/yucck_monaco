import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env.js'

export const CSRF_COOKIE_NAME = 'csrf_token'
export const CSRF_HEADER_NAME = 'x-csrf-token'

/**
 * Issues a cryptographically secure double-submit CSRF cookie.
 * httpOnly is intentionally false so the client JS can read it
 * and send it back via the X-CSRF-Token header.
 */
export function issueCsrfToken(res: Response): string {
  const token = crypto.randomBytes(32).toString('hex')
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  })
  return token
}

export function clearCsrfToken(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
}

/**
 * Double-submit cookie verification middleware.
 * Validates header against cookie for all state-changing HTTP methods.
 */
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Safe HTTP methods do not change state
  const safeMethods = ['GET', 'HEAD', 'OPTIONS']
  if (safeMethods.includes(req.method.toUpperCase())) {
    return next()
  }

  // Webhooks have their own cryptographic signature verification
  if (req.path.startsWith('/webhooks')) {
    return next()
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME]
  const headerToken = req.headers[CSRF_HEADER_NAME]

  if (
    typeof cookieToken !== 'string' ||
    typeof headerToken !== 'string' ||
    cookieToken.length === 0 ||
    headerToken.length === 0
  ) {
    res.status(403).json({ error: 'invalid_csrf_token' })
    return
  }

  const cookieBuf = Buffer.from(cookieToken)
  const headerBuf = Buffer.from(headerToken)

  if (
    cookieBuf.length !== headerBuf.length ||
    !crypto.timingSafeEqual(cookieBuf, headerBuf)
  ) {
    res.status(403).json({ error: 'invalid_csrf_token' })
    return
  }

  next()
}
