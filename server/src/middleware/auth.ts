import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env.js'
import { User, type IUser } from '../models/User.js'
import type { AuthSessionPayload, UserRole } from '@interncert/types'

export const SESSION_COOKIE_NAME = 'session'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: IUser
    }
  }
}

export function signSessionToken(
  user: { _id: unknown; role: UserRole; session_version: number },
  role: UserRole,
): string {
  const expiresIn = role === 'admin' ? '2h' : '24h'
  const payload: AuthSessionPayload = {
    sub: String(user._id),
    role: user.role,
    session_version: user.session_version,
  }

  return jwt.sign(payload, env.JWT_SECRET, { expiresIn })
}

export function setSessionCookie(
  res: Response,
  token: string,
  role: UserRole,
): void {
  const maxAge = role === 'admin' ? 2 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME]

  if (!token || typeof token !== 'string') {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthSessionPayload

    const user = await User.findById(decoded.sub)
    if (!user) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    // Invalidation check (audit SEC-10): reject if session_version has changed
    if (user.session_version !== decoded.session_version) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    req.user = user
    next()
  } catch {
    res.status(401).json({ error: 'unauthorized' })
  }
}

export function requireRole(role: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    if (req.user.role !== role) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    next()
  }
}
