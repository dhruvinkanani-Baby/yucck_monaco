import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.js'
import { AuthLayout } from '../components/AuthLayout.js'

export function ForgotPasswordPage() {
  const { forgotPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)
    setLoading(true)

    try {
      const res = await forgotPassword({ email })
      setSuccessMessage(
        res.message ||
          'If an account matches that email, a password reset link has been dispatched.',
      )
    } catch (err: unknown) {
      const apiErr = err as { data?: { error?: string; message?: string } }
      if (apiErr?.data?.error === 'too_many_requests') {
        setError(
          apiErr.data.message ||
            'Too many reset requests. Please wait an hour before trying again.',
        )
      } else {
        setError(
          apiErr?.data?.message ||
            'Unable to process request. Please try again.',
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email to receive a secure password recovery link"
    >
      {successMessage ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="alert alert-success">
            <strong>Check your inbox:</strong> {successMessage}
          </div>
          <p
            style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              textAlign: 'center',
            }}
          >
            The link will remain active for 1 hour. Please check your spam
            folder if you do not see it within a few minutes.
          </p>
          <Link
            to="/login"
            className="btn-primary"
            style={{ textDecoration: 'none', textAlign: 'center' }}
          >
            Back to Sign In
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="forgot-email">
              Email address
            </label>
            <input
              id="forgot-email"
              type="email"
              className="form-input"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={loading}
            />
            <span className="form-helper">
              We will send a single-use token valid for 60 minutes.
            </span>
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" />
                <span>Sending link...</span>
              </>
            ) : (
              'Send Reset Link'
            )}
          </button>
        </form>
      )}

      <footer className="auth-footer">
        Remembered your password? <Link to="/login">Sign in</Link>
      </footer>
    </AuthLayout>
  )
}
