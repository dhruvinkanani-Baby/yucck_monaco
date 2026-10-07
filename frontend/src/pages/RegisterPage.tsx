import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.js'
import { AuthLayout } from '../components/AuthLayout.js'

export function RegisterPage() {
  const navigate = useNavigate()
  const { register } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

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
      await register({ email, password })
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const apiErr = err as { data?: { error?: string; message?: string } }
      if (apiErr?.data?.error === 'email_already_registered') {
        setError('An account with this email address already exists.')
      } else if (apiErr?.data?.error === 'validation_error') {
        setError('Please provide a valid email and strong password.')
      } else if (apiErr?.data?.error === 'too_many_requests') {
        setError('Too many registration attempts. Please try again later.')
      } else {
        setError(
          apiErr?.data?.message || 'Registration failed. Please try again.',
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start your verified engineering journey with InternCert"
    >
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        {error && <div className="alert alert-error">{error}</div>}

        <div className="form-group">
          <label className="form-label" htmlFor="register-email">
            Email address
          </label>
          <input
            id="register-email"
            type="email"
            className="form-input"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="register-password">
            Password
          </label>
          <input
            id="register-password"
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
          <label className="form-label" htmlFor="confirm-password">
            Confirm password
          </label>
          <input
            id="confirm-password"
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
              <span>Creating account...</span>
            </>
          ) : (
            'Create Account'
          )}
        </button>
      </form>

      <footer className="auth-footer">
        Already have an account? <Link to="/login">Sign in here</Link>
      </footer>
    </AuthLayout>
  )
}
