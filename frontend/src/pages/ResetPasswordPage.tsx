import React, { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.js'
import { AuthLayout } from '../components/AuthLayout.js'

export function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const { resetPassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError('Password reset token is missing from the URL.')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      await resetPassword({ token, password })
      setSuccess(true)
    } catch (err: unknown) {
      const apiErr = err as { data?: { error?: string; message?: string } }
      if (apiErr?.data?.error === 'invalid_or_expired_token') {
        setError(
          'This password reset link is invalid or has expired. Please request a new one.',
        )
      } else if (apiErr?.data?.error === 'too_many_requests') {
        setError('Too many requests. Please wait a moment before trying again.')
      } else {
        setError(
          apiErr?.data?.message ||
            'Failed to reset password. Please try again.',
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Create new password"
      subtitle="Enter a new password to secure your account"
    >
      {success ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="alert alert-success">
            <strong>Password reset successful!</strong>
            <p style={{ marginTop: '6px' }}>
              All previous active sessions have been invalidated for your
              security. You can now log in with your new credentials.
            </p>
          </div>
          <Link
            to="/login"
            className="btn-primary"
            style={{ textDecoration: 'none', textAlign: 'center' }}
          >
            Proceed to Sign In
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="new-password">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              className="form-input"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              disabled={loading}
            />
            <span className="form-helper">Minimum 8 characters</span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="confirm-new-password">
              Confirm new password
            </label>
            <input
              id="confirm-new-password"
              type="password"
              className="form-input"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" />
                <span>Updating password...</span>
              </>
            ) : (
              'Reset Password'
            )}
          </button>
        </form>
      )}

      {!success && (
        <footer className="auth-footer">
          Remember your old password? <Link to="/login">Sign in</Link>
        </footer>
      )}
    </AuthLayout>
  )
}
