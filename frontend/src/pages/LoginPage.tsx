import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.js'
import { AuthLayout } from '../components/AuthLayout.js'

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await login({ email, password })
      navigate('/', { replace: true })
    } catch (err: unknown) {
      const apiErr = err as { data?: { error?: string; message?: string } }
      if (apiErr?.data?.error === 'too_many_requests') {
        setError(
          apiErr.data.message ||
            'Too many login attempts. Please wait 15 minutes before trying again.',
        )
      } else if (apiErr?.data?.error === 'invalid_credentials') {
        setError('Invalid email or password.')
      } else if (apiErr?.data?.error === 'invalid_csrf_token') {
        setError('Security token expired or missing. Please refresh the page.')
      } else {
        setError(apiErr?.data?.message || 'Login failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in to your account"
      subtitle="Access your active internships and verified certificates"
    >
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        {error && <div className="alert alert-error">{error}</div>}

        <div className="form-group">
          <label className="form-label" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
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
          <div className="form-label-row">
            <label className="form-label" htmlFor="password">
              Password
            </label>
            <Link
              to="/forgot-password"
              style={{ fontSize: '12px', color: 'var(--text-muted)' }}
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            className="form-input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            disabled={loading}
          />
        </div>

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? (
            <>
              <span className="spinner" />
              <span>Authenticating...</span>
            </>
          ) : (
            'Sign In'
          )}
        </button>
      </form>

      <footer className="auth-footer">
        Don&apos;t have an account? <Link to="/register">Create one here</Link>
      </footer>
    </AuthLayout>
  )
}
