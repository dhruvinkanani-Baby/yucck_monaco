import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import type { Request, Response, NextFunction } from 'express'

/**
 * Generates a new TOTP secret, URI, and QR code data URL for MFA enrollment
 */
export async function generateMfaSecret(email: string): Promise<{
  secret: string
  uri: string
  qrCode: string
}> {
  const secret = new OTPAuth.Secret({ size: 20 })
  const totp = new OTPAuth.TOTP({
    issuer: 'InternCert',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  })

  const uri = totp.toString()
  const qrCode = await QRCode.toDataURL(uri, {
    margin: 1,
    width: 200,
  })

  return {
    secret: secret.base32,
    uri,
    qrCode,
  }
}

/**
 * Validates a submitted TOTP token against a user's base32 secret
 */
export function verifyMfaToken(secretBase32: string, token: string): boolean {
  if (!token || typeof token !== 'string' || !/^\d{6}$/.test(token.trim())) {
    return false
  }

  const secret = OTPAuth.Secret.fromBase32(secretBase32)
  const totp = new OTPAuth.TOTP({
    issuer: 'InternCert',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  })

  // Window of 1 time-step (±30 seconds) accounts for mild client clock drift
  const delta = totp.validate({
    token: token.trim(),
    window: 1,
  })

  return delta !== null
}

/**
 * Step-up authentication middleware: requires a fresh TOTP code for high-risk admin endpoints (SEC-15)
 */
export function requireMfaStepUp(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.user

  if (!user || user.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  // 1. Admin must have TOTP enabled
  if (!user.totp_enabled || !user.totp_secret) {
    res.status(403).json({
      error: 'mfa_not_enrolled',
      message:
        'MFA must be configured on your admin account before performing this action.',
    })
    return
  }

  // 2. Read MFA code from x-mfa-code header or request body
  const rawCode =
    req.headers['x-mfa-code'] ||
    (typeof req.body === 'object' && req.body !== null
      ? req.body.totp_code
      : undefined)

  const code = Array.isArray(rawCode) ? rawCode[0] : rawCode

  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    res.status(403).json({
      error: 'mfa_required',
      message: 'Valid 6-digit MFA step-up code required for this action.',
    })
    return
  }

  // 3. Verify TOTP token
  const isValid = verifyMfaToken(user.totp_secret, code)
  if (!isValid) {
    res.status(403).json({
      error: 'invalid_mfa_code',
      message: 'The provided MFA code is invalid or has expired.',
    })
    return
  }

  next()
}
