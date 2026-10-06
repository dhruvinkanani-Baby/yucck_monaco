import React from 'react'

interface AuthLayoutProps {
  title: string
  subtitle: string
  children: React.ReactNode
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <header className="brand-header">
          <div className="brand-badge">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>INTERNCERT</span>
          </div>
          <h1 className="brand-title">{title}</h1>
          <p className="brand-subtitle">{subtitle}</p>
        </header>

        {children}
      </div>
    </div>
  )
}
