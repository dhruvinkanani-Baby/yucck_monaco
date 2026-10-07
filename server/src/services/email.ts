import { Resend } from 'resend'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { escapeHtml } from '../utils/sanitize.js'

export const resend = new Resend(env.RESEND_API_KEY)

export interface SendResetEmailParams {
  to: string
  rawToken: string
}

export function buildPasswordResetEmailHtml(rawToken: string): string {
  const resetUrl = `${env.FRONTEND_URL}/reset-password/${encodeURIComponent(rawToken)}`
  const safeResetUrl = escapeHtml(resetUrl)
  return `<p>You requested a password reset. Click the link below to set a new password:</p><p><a href="${safeResetUrl}">${safeResetUrl}</a></p><p>This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>`
}

export async function sendPasswordResetEmail({
  to,
  rawToken,
}: SendResetEmailParams): Promise<{ html: string }> {
  const resetUrl = `${env.FRONTEND_URL}/reset-password/${rawToken}`
  const html = buildPasswordResetEmailHtml(rawToken)

  if (env.NODE_ENV === 'test') {
    logger.info({ to, resetUrl }, '[Test] Mock password reset email dispatched')
    return { html }
  }

  try {
    const result = await resend.emails.send({
      from: 'InternCert <security@interncert.dev>',
      to: [to],
      subject: 'Reset your InternCert password',
      text: `You requested a password reset. Use the link below to set a new password:\n\n${resetUrl}\n\nThis link is valid for 1 hour. If you did not request this, please ignore this email.`,
      html,
    })

    logger.info({ id: result.data?.id, to }, 'Password reset email sent')
  } catch (err) {
    logger.error(
      { err, to },
      'Failed to dispatch password reset email via Resend',
    )
  }

  return { html }
}

export interface SendCertificateEmailParams {
  to: string
  studentName: string
  internshipTitle: string
  verificationCode: string
  pdfUrl: string
}

export function buildCertificateEmailHtml({
  studentName,
  internshipTitle,
  verificationCode,
  pdfUrl,
}: {
  studentName: string
  internshipTitle: string
  verificationCode: string
  pdfUrl: string
}): string {
  const safeName = escapeHtml(studentName)
  const safeTitle = escapeHtml(internshipTitle)
  const safeCode = escapeHtml(verificationCode)
  const safeVerifyUrl = `${env.FRONTEND_URL}/verify/${encodeURIComponent(verificationCode)}`
  const safePdfUrl = `${env.FRONTEND_URL}${escapeHtml(pdfUrl)}`

  return `
    <h2>Congratulations, ${safeName}!</h2>
    <p>You have successfully completed all milestones for the <strong>${safeTitle}</strong> internship program.</p>
    <p><strong>Credential ID:</strong> ${safeCode}</p>
    <p><a href="${safeVerifyUrl}" style="display:inline-block;padding:10px 20px;background:#0A1628;color:#C9A84C;text-decoration:none;border-radius:6px;font-weight:bold;">Verify Certificate Online</a></p>
    <p>You can also access your certificate PDF directly <a href="${safePdfUrl}">here</a>.</p>
  `
}

export async function sendCertificateIssuedEmail({
  to,
  studentName,
  internshipTitle,
  verificationCode,
  pdfUrl,
}: SendCertificateEmailParams): Promise<{ html: string }> {
  const verifyUrl = `${env.FRONTEND_URL}/verify/${verificationCode}`
  const html = buildCertificateEmailHtml({
    studentName,
    internshipTitle,
    verificationCode,
    pdfUrl,
  })

  if (env.NODE_ENV === 'test') {
    logger.info(
      { to, verificationCode, verifyUrl },
      '[Test] Mock certificate email dispatched',
    )
    return { html }
  }

  try {
    const result = await resend.emails.send({
      from: 'InternCert <certificates@interncert.dev>',
      to: [to],
      subject: `Your Certificate for ${internshipTitle} is Ready!`,
      text: `Congratulations ${studentName}!\n\nYou have successfully completed the ${internshipTitle} internship.\nYour Certificate Credential ID is: ${verificationCode}\n\nVerify and view your certificate here: ${verifyUrl}\nDownload PDF: ${env.FRONTEND_URL}${pdfUrl}`,
      html,
    })

    logger.info(
      { id: result.data?.id, to, verificationCode },
      'Certificate issued email sent',
    )
  } catch (err) {
    logger.error(
      { err, to, verificationCode },
      'Failed to dispatch certificate email via Resend',
    )
  }

  return { html }
}

export const emailService = {
  sendPasswordResetEmail,
  sendCertificateIssuedEmail,
  buildCertificateEmailHtml,
  buildPasswordResetEmailHtml,
}
