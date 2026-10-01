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
