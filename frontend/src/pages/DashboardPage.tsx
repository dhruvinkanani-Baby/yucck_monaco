import { useAuth } from '../context/AuthContext.js'

export function DashboardPage() {
  const { user, logout } = useAuth()

  if (!user) return null

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="dash-brand">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6366f1"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <h2>InternCert Portal</h2>
        </div>

        <div className="user-nav">
          <span className="user-email">{user.email}</span>
          <span
            className={`role-tag ${
              user.role === 'admin' ? 'role-admin' : 'role-student'
            }`}
          >
            {user.role}
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            className="btn-secondary"
          >
            Log Out
          </button>
        </div>
      </header>

      <main>
        <div className="grid-cards">
          <div className="dash-card">
            <div className="card-title">Session State</div>
            <div className="card-value">Version #{user.session_version}</div>
            <div className="card-desc">
              Protected by rotating cryptographic session version (SEC-10
              conforming).
            </div>
          </div>

          <div className="dash-card">
            <div className="card-title">Account Role</div>
            <div className="card-value" style={{ textTransform: 'capitalize' }}>
              {user.role}
            </div>
            <div className="card-desc">
              ID: <code style={{ fontSize: '11px' }}>{user.id}</code>
            </div>
          </div>

          <div className="dash-card">
            <div className="card-title">Member Since</div>
            <div className="card-value">
              {new Date(user.created_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </div>
            <div className="card-desc">
              Authenticated via Argon2 & JWT cookie.
            </div>
          </div>
        </div>

        <div className="dash-card">
          <div className="card-title">Active Security Architecture</div>
          <div className="security-badge-list">
            <div className="security-badge-item">
              <span className="dot-active" />
              <span>
                <strong>SEC-09:</strong> Double-submit CSRF cookie token
                enforced on state-changing requests.
              </span>
            </div>
            <div className="security-badge-item">
              <span className="dot-active" />
              <span>
                <strong>SEC-10:</strong> Immediate pre-reset session
                invalidation across devices via session version bumping.
              </span>
            </div>
            <div className="security-badge-item">
              <span className="dot-active" />
              <span>
                <strong>Strict Transport:</strong> Credentials bound with
                HttpOnly, SameSite=Lax cookies with zero tokens in response
                bodies.
              </span>
            </div>
            <div className="security-badge-item">
              <span className="dot-active" />
              <span>
                <strong>Rate Limiting:</strong> Redis-backed protection active
                across login, password reset, and verification routes.
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
