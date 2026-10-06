export type UserRole = 'student' | 'admin'

export interface UserPublic {
  id: string
  email: string
  role: UserRole
  session_version: number
  created_at: string
}

export interface RegisterDTO {
  email: string
  password: string
}

export interface LoginDTO {
  email: string
  password: string
}

export interface ForgotPasswordDTO {
  email: string
}

export interface ResetPasswordDTO {
  token: string
  password: string
}

export interface AuthSessionPayload {
  sub: string
  role: UserRole
  session_version: number
  iat?: number
  exp?: number
}

export interface GenericResponse {
  status: string
  message?: string
}

// Domain Model Types

export interface TaskDefinition {
  task_number: number
  title: string
  description: string
  deadline_days: number
}

export interface InternshipPublic {
  id: string
  title: string
  description: string
  tasks: TaskDefinition[]
  price: number
  currency: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type EnrollmentStatus = 'active' | 'expired' | 'closed'

export interface EnrollmentPublic {
  id: string
  user_id: string
  internship_id: string
  status: EnrollmentStatus
  current_task: number
  start_date: string
  end_date: string
  completed_at?: string | null
  created_at: string
  updated_at: string
}

export type TaskSubmissionStatus = 'pending' | 'approved' | 'rejected'

export interface TaskSubmissionPublic {
  id: string
  enrollment_id: string
  task_number: number
  status: TaskSubmissionStatus
  content: string
  feedback?: string | null
  submitted_at: string
  reviewed_at?: string | null
  reviewed_by?: string | null
}

export type PaymentStatus =
  'created' | 'paid' | 'failed' | 'refunded' | 'partially_refunded'

export interface PaymentPublic {
  id: string
  user_id: string
  internship_id: string
  razorpay_order_id: string
  razorpay_payment_id?: string | null
  amount: number
  currency: string
  status: PaymentStatus
  created_at: string
  updated_at: string
}

export type CertificateStatus = 'valid' | 'revoked'

export interface CertificatePublic {
  id: string
  enrollment_id: string
  verification_code: string
  pdf_url: string
  status: CertificateStatus
  issued_at: string
  revoked_at?: string | null
  revoked_reason?: string | null
}

export interface VerifyCertificateResponse {
  valid: boolean
  verification_code: string
  student_name: string
  internship_title: string
  issued_at: string
  status?: CertificateStatus
  revoked_reason?: string | null
  pdf_url?: string
}

export interface MfaSetupResponse {
  secret: string
  qr_code: string
  uri: string
}

export interface MfaVerifyDTO {
  totp_code: string
}

export interface RevokeCertificateDTO {
  reason: string
}

export interface RefundPaymentDTO {
  amount?: number
  reason?: string
}

export interface AuditLogEntry {
  id: string
  admin_id: string
  action: string
  target_type: string
  target_id: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ip?: string | null
  request_id?: string | null
  created_at: string
}

export interface CreateOrderDTO {
  internship_id: string
}

export interface CreateOrderResponse {
  order_id: string
  amount: number
  currency: string
  key_id: string
}

export interface VerifyPaymentDTO {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

export interface VerifyPaymentResponse {
  status: string
  enrollment: EnrollmentPublic
}

export interface SubmitTaskDTO {
  enrollment_id: string
  content: string
}

export interface ReviewSubmissionDTO {
  decision: 'approved' | 'rejected'
  feedback?: string
}
