import fs from 'node:fs'
import type { Request, Response, NextFunction } from 'express'
import { Certificate } from '../models/Certificate.js'
import { Enrollment } from '../models/Enrollment.js'
import { User } from '../models/User.js'
import { Internship } from '../models/Internship.js'
import { certificateService } from '../services/certificateService.js'

export async function verifyCertificate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { code } = req.params

    if (!code || typeof code !== 'string' || code.trim().length < 6) {
      res.status(400).json({
        error: 'invalid_code',
        message: 'Invalid certificate verification code format.',
      })
      return
    }

    const trimmedCode = code.trim()

    // 1. Look up Certificate by opaque code
    const cert = await Certificate.findOne({ verification_code: trimmedCode })
    if (!cert) {
      // SEC-14: No data leak, generic 404
      res.status(404).json({
        valid: false,
        error: 'certificate_not_found',
        message:
          'No authentic certificate found matching this verification code.',
      })
      return
    }

    // 2. Fetch associated enrollment, user, and internship for safe minimal projection
    const enrollment = await Enrollment.findById(cert.enrollment_id)
    const user = enrollment ? await User.findById(enrollment.user_id) : null
    const internship = enrollment
      ? await Internship.findById(enrollment.internship_id)
      : null

    const studentName = user?.email
      ? user.email.split('@')[0].replace(/[._-]/g, ' ').toUpperCase()
      : 'CERTIFIED SCHOLAR'

    if (cert.status === 'revoked') {
      res.status(200).json({
        valid: false,
        status: 'revoked',
        verification_code: cert.verification_code,
        student_name: studentName,
        internship_title: internship?.title || 'Verified Internship Program',
        issued_at: cert.issued_at.toISOString(),
        revoked_at: cert.revoked_at?.toISOString() || null,
        revoked_reason:
          cert.revoked_reason ||
          'Certificate revoked by administrative authority.',
      })
      return
    }

    // Minimal public fields per SEC-14
    res.status(200).json({
      valid: true,
      status: 'valid',
      verification_code: cert.verification_code,
      student_name: studentName,
      internship_title: internship?.title || 'Verified Internship Program',
      issued_at: cert.issued_at.toISOString(),
      pdf_url: cert.pdf_url,
    })
  } catch (err) {
    next(err)
  }
}

export async function downloadCertificatePdf(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawCode = Array.isArray(req.params.code)
      ? req.params.code[0]
      : req.params.code
    const trimmedCode = typeof rawCode === 'string' ? rawCode.trim() : ''

    if (!trimmedCode) {
      res.status(400).json({ error: 'invalid_code' })
      return
    }

    const cert = await Certificate.findOne({ verification_code: trimmedCode })
    if (!cert) {
      res.status(404).json({ error: 'certificate_not_found' })
      return
    }

    if (cert.status === 'revoked') {
      res.status(410).json({
        error: 'certificate_revoked',
        message: 'This certificate has been revoked and cannot be downloaded.',
        revoked_reason: cert.revoked_reason,
      })
      return
    }

    const filePath = certificateService.getCertificateFilePath(
      cert.verification_code,
    )

    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader(
        'Content-Disposition',
        `inline; filename="interncert-${cert.verification_code}.pdf"`,
      )
      fs.createReadStream(filePath).pipe(res)
      return
    }

    // If PDF was cleared or running on ephemeral disk, render on-the-fly
    const enrollment = await Enrollment.findById(cert.enrollment_id)
    const user = enrollment ? await User.findById(enrollment.user_id) : null
    const internship = enrollment
      ? await Internship.findById(enrollment.internship_id)
      : null

    const studentName = user?.email
      ? user.email.split('@')[0].replace(/[._-]/g, ' ').toUpperCase()
      : 'CERTIFIED SCHOLAR'

    const buffer = await certificateService.generatePdfBuffer({
      verificationCode: cert.verification_code,
      studentName,
      internshipTitle: internship?.title || 'Internship Program',
      issuedAt: cert.issued_at,
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `inline; filename="interncert-${cert.verification_code}.pdf"`,
    )
    res.send(buffer)
  } catch (err) {
    next(err)
  }
}
