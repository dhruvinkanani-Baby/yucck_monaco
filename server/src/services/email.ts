import { Resend } from 'resend'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

export const resend = new Resend(env.RESEND_API_KEY)

export interface SendResetEmailParams {
  to: string
  rawToken: string
}

export async function sendPasswordResetEmail({
  to,
  rawToken,
}: SendResetEmailParams): Promise<void> {
  const resetUrl = `${env.FRONTEND_URL}/reset-password/${rawToken}`

  if (env.NODE_ENV === 'test') {
    logger.info({ to, resetUrl }, '[Test] Mock password reset email dispatched')
    return
  }

  try {
    const result = await resend.emails.send({
      from: 'InternCert <security@interncert.dev>',
      to: [to],
      subject: 'Reset your InternCert password',
      text: `You requested a password reset. Use the link below to set a new password:\n\n${resetUrl}\n\nThis link is valid for 1 hour. If you did not request this, please ignore this email.`,
      html: `<p>You requested a password reset. Click the link below to set a new password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>`,
    })

    logger.info({ id: result.data?.id, to }, 'Password reset email sent')
  } catch (err) {
    logger.error(
      { err, to },
      'Failed to dispatch password reset email via Resend',
    )
  }
}
