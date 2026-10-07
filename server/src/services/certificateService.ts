import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'
import PDFDocument from 'pdfkit'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

export interface CertificateRenderParams {
  verificationCode: string
  studentName: string
  internshipTitle: string
  startDate?: Date
  endDate?: Date
  issuedAt: Date
}

// Ensure certificate directory exists
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'certificates')
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

export class CertificateService {
  /**
   * Generates QR code as PNG Buffer linking to the frontend verification URL
   */
  async generateQrCodeBuffer(verificationCode: string): Promise<Buffer> {
    const verificationUrl = `${env.FRONTEND_URL}/verify/${verificationCode}`
    return await QRCode.toBuffer(verificationUrl, {
      errorCorrectionLevel: 'H',
      type: 'png',
      margin: 1,
      width: 140,
      color: {
        dark: '#0A1628',
        light: '#FFFFFF',
      },
    })
  }

  /**
   * Generates a high-quality PDF certificate buffer
   */
  async generatePdfBuffer(params: CertificateRenderParams): Promise<Buffer> {
    const qrBuffer = await this.generateQrCodeBuffer(params.verificationCode)

    return new Promise((resolve, reject) => {
      // Landscape A4: 842 x 595 points
      const doc = new PDFDocument({
        size: [842, 595],
        layout: 'landscape',
        margins: { top: 30, bottom: 30, left: 30, right: 30 },
      })

      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', (err: Error) => reject(err))

      const width = 842
      const height = 595

      // 1. Deep Navy Background (#0A1628)
      doc.rect(0, 0, width, height).fill('#0A1628')

      // 2. Outer Ornate Gold Border (#C9A84C)
      doc
        .lineWidth(4)
        .strokeColor('#C9A84C')
        .rect(20, 20, width - 40, height - 40)
        .stroke()

      // 3. Inner Thin Gold Border
      doc
        .lineWidth(1)
        .strokeColor('#C9A84C')
        .rect(26, 26, width - 52, height - 52)
        .stroke()

      // 4. Header: INTERNCERT
      doc
        .font('Helvetica-Bold')
        .fontSize(22)
        .fillColor('#C9A84C')
        .text('INTERNCERT', 0, 50, { align: 'center', characterSpacing: 4 })

      // Small Divider
      doc
        .moveTo(width / 2 - 60, 78)
        .lineTo(width / 2 + 60, 78)
        .lineWidth(1)
        .strokeColor('#C9A84C')
        .stroke()

      // 5. Title: CERTIFICATE OF COMPLETION
      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .fillColor('#E2D193')
        .text('CERTIFICATE OF COMPLETION', 0, 95, {
          align: 'center',
          characterSpacing: 3,
        })

      // 6. Subtitle
      doc
        .font('Helvetica')
        .fontSize(12)
        .fillColor('#A0AEC0')
        .text('This is to certify that', 0, 130, { align: 'center' })

      // 7. Student Name
      doc
        .font('Helvetica-Bold')
        .fontSize(32)
        .fillColor('#FFFFFF')
        .text(params.studentName, 0, 155, { align: 'center' })

      // 8. Description
      doc
        .font('Helvetica')
        .fontSize(12)
        .fillColor('#A0AEC0')
        .text('has successfully completed all requirements of the', 0, 205, {
          align: 'center',
        })

      // 9. Internship Title
      doc
        .font('Helvetica-Bold')
        .fontSize(22)
        .fillColor('#C9A84C')
        .text(params.internshipTitle, 0, 230, { align: 'center' })

      // 10. Statement
      const issueDateStr = params.issuedAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#CBD5E0')
        .text(
          'Demonstrating verified technical proficiency, rigorous code reviews, and milestone achievements.',
          0,
          270,
          { align: 'center' },
        )

      // 11. Lower Box / Details
      // QR Code Box on bottom right
      const qrX = width - 145
      const qrY = height - 150
      doc.rect(qrX - 4, qrY - 4, 88, 88).fill('#FFFFFF')
      doc.image(qrBuffer, qrX, qrY, { width: 80, height: 80 })

      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#A0AEC0')
        .text('Scan to verify', qrX - 10, qrY + 86, {
          width: 100,
          align: 'center',
        })

      // Verified Seal on bottom left
      const sealX = 60
      const sealY = height - 145
      doc
        .circle(sealX + 35, sealY + 35, 30)
        .lineWidth(2)
        .strokeColor('#C9A84C')
        .stroke()

      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#C9A84C')
        .text('VERIFIED', sealX, sealY + 28, { width: 70, align: 'center' })

      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#E2D193')
        .text('INTERNCERT', sealX, sealY + 39, { width: 70, align: 'center' })

      // Signatures
      const sig1X = 180
      const sig2X = width - 360
      const sigY = height - 105

      // Signature 1
      doc
        .moveTo(sig1X, sigY)
        .lineTo(sig1X + 140, sigY)
        .lineWidth(1)
        .strokeColor('#4A5568')
        .stroke()
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#A0AEC0')
        .text('Program Director', sig1X, sigY + 6, {
          width: 140,
          align: 'center',
        })

      // Signature 2
      doc
        .moveTo(sig2X, sigY)
        .lineTo(sig2X + 140, sigY)
        .lineWidth(1)
        .strokeColor('#4A5568')
        .stroke()
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#A0AEC0')
        .text('Academic Lead', sig2X, sigY + 6, {
          width: 140,
          align: 'center',
        })

      // Metadata at center bottom
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#718096')
        .text(`Credential ID: ${params.verificationCode}`, 0, height - 72, {
          align: 'center',
        })

      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#718096')
        .text(`Issued: ${issueDateStr}`, 0, height - 58, { align: 'center' })

      doc.end()
    })
  }

  /**
   * Generates and writes the PDF file to disk, returning its accessible path
   */
  async saveCertificatePdf(
    params: CertificateRenderParams,
  ): Promise<{ filePath: string; pdfUrl: string }> {
    const buffer = await this.generatePdfBuffer(params)
    const fileName = `${params.verificationCode}.pdf`
    const filePath = path.join(UPLOAD_DIR, fileName)

    await fs.promises.writeFile(filePath, buffer)
    logger.info(
      { verificationCode: params.verificationCode, filePath },
      'Certificate PDF rendered and saved to storage',
    )

    // Accessible URL on the server API
    const pdfUrl = `/verify/${params.verificationCode}/pdf`
    return { filePath, pdfUrl }
  }

  /**
   * Gets absolute path of a stored certificate PDF by code
   */
  getCertificateFilePath(verificationCode: string): string {
    return path.join(UPLOAD_DIR, `${verificationCode}.pdf`)
  }
}

export const certificateService = new CertificateService()
