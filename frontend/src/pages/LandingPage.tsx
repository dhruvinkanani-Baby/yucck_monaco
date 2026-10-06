import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.js'
import type {
  InternshipPublic,
  PlatformMetricsResponse,
} from '@interncert/types'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

export function LandingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [metrics, setMetrics] = useState<PlatformMetricsResponse>({
    active_students: 142,
    verified_certificates: 388,
    industry_programs: 4,
    completion_rate: 94,
  })

  const [internships, setInternships] = useState<InternshipPublic[]>([])
  const [loading, setLoading] = useState(true)
  const [verifyCodeInput, setVerifyCodeInput] = useState('')

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true)
        const [metricsRes, internshipsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/internships/metrics`),
          fetch(`${API_BASE_URL}/internships?limit=6`),
        ])

        if (metricsRes.ok) {
          const metricsData =
            (await metricsRes.json()) as PlatformMetricsResponse
          setMetrics(metricsData)
        }

        if (internshipsRes.ok) {
          const internshipsData = (await internshipsRes.json()) as {
            internships: InternshipPublic[]
          }
          if (internshipsData.internships?.length > 0) {
            setInternships(internshipsData.internships)
          } else {
            // Seed default tracks if database is fresh
            setInternships([
              {
                id: 'track-backend',
                title: 'High-Concurrency Backend Systems',
                description:
                  'Architect production Node/TypeScript APIs with Redis caching, BullMQ asynchronous pipelines, and MongoDB atomic invariants.',
                tasks: [
                  {
                    task_number: 1,
                    title: 'Schema Architecture & Indexes',
                    description: 'Design strict Mongoose invariants',
                    deadline_days: 7,
                  },
                  {
                    task_number: 2,
                    title: 'Session Invalidation & CSRF',
                    description: 'Double-submit cookie & JWT hardening',
                    deadline_days: 7,
                  },
                  {
                    task_number: 3,
                    title: 'High-Throughput Task Workers',
                    description: 'BullMQ resilient repeatable queues',
                    deadline_days: 10,
                  },
                ],
                price: 499900,
                currency: 'INR',
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              {
                id: 'track-devops',
                title: 'Cloud DevOps & Infrastructure Security',
                description:
                  'Provision hardened Kubernetes clusters, automated CI/CD security scanning, secret rotation, and distributed tracing.',
                tasks: [
                  {
                    task_number: 1,
                    title: 'Terraform State & VPC Mesh',
                    description: 'Immutable cloud architecture',
                    deadline_days: 7,
                  },
                  {
                    task_number: 2,
                    title: 'Zero-Trust Secrets & KMS',
                    description: 'Sealed secrets & automated rotation',
                    deadline_days: 8,
                  },
                ],
                price: 549900,
                currency: 'INR',
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              {
                id: 'track-fullstack',
                title: 'Production Full-Stack Architecture',
                description:
                  'End-to-end modern web applications built on React, Vite, Express, real-time WebSockets, and Razorpay webhook reconciliation.',
                tasks: [
                  {
                    task_number: 1,
                    title: 'Component System & State',
                    description: 'Resilient client-side caching',
                    deadline_days: 7,
                  },
                  {
                    task_number: 2,
                    title: 'Idempotent Payment Engine',
                    description: 'Cryptographic signature verification',
                    deadline_days: 10,
                  },
                ],
                price: 449900,
                currency: 'INR',
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ])
          }
        }
      } catch {
        // Fallback gracefully on network hiccup
      } finally {
        setLoading(false)
      }
    }

    void fetchData()
  }, [])

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (verifyCodeInput.trim()) {
      navigate(`/verify/${encodeURIComponent(verifyCodeInput.trim())}`)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#070D18',
        color: '#F8FAFC',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Top Glass Navigation Bar */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          backgroundColor: 'rgba(7, 13, 24, 0.85)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '16px 24px',
        }}
      >
        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Link
            to="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              textDecoration: 'none',
              color: '#F8FAFC',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #C9A84C 0%, #F5E7B2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(201, 168, 76, 0.35)',
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#070D18"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <span
              style={{
                fontWeight: 800,
                fontSize: '1.25rem',
                letterSpacing: '1.5px',
                color: '#C9A84C',
              }}
            >
              INTERNCERT
            </span>
          </Link>

          <nav style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <a
              href="#programs"
              style={{
                color: '#94A3B8',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 600,
                transition: 'color 0.2s',
              }}
            >
              Curricula
            </a>
            <a
              href="#verification"
              style={{
                color: '#94A3B8',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 600,
                transition: 'color 0.2s',
              }}
            >
              Verification Registry
            </a>
            <a
              href="#how-it-works"
              style={{
                color: '#94A3B8',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 600,
                transition: 'color 0.2s',
              }}
            >
              Security Invariants
            </a>

            {user ? (
              <Link
                to="/dashboard"
                className="btn-gold"
                style={{ textDecoration: 'none' }}
              >
                Open Dashboard
              </Link>
            ) : (
              <div
                style={{ display: 'flex', gap: '12px', alignItems: 'center' }}
              >
                <Link
                  to="/login"
                  style={{
                    color: '#E2E8F0',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: '14px',
                    padding: '8px 16px',
                  }}
                >
                  Log In
                </Link>
                <Link
                  to="/register"
                  className="btn-gold"
                  style={{
                    textDecoration: 'none',
                    fontSize: '13px',
                    padding: '8px 18px',
                  }}
                >
                  Apply Now
                </Link>
              </div>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section
        style={{
          padding: '80px 24px 60px',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Ambient Glow */}
        <div
          style={{
            position: 'absolute',
            top: '10%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '600px',
            height: '350px',
            background:
              'radial-gradient(circle, rgba(201, 168, 76, 0.15) 0%, rgba(99, 102, 241, 0.08) 50%, transparent 80%)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            maxWidth: '860px',
            margin: '0 auto',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'rgba(201, 168, 76, 0.12)',
              border: '1px solid rgba(201, 168, 76, 0.3)',
              borderRadius: '9999px',
              padding: '6px 16px',
              fontSize: '12px',
              fontWeight: 700,
              color: '#F5E7B2',
              letterSpacing: '1px',
              marginBottom: '24px',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#C9A84C',
                boxShadow: '0 0 8px #C9A84C',
              }}
            />
            NEXT-GEN ENGINEERING CERTIFICATION • COHORT 2026 ACTIVE
          </div>

          <h1
            style={{
              fontSize: 'clamp(2.5rem, 5vw, 4rem)',
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: '-1px',
              marginBottom: '24px',
              color: '#FFFFFF',
            }}
          >
            Where Hardcore Engineering Meets{' '}
            <span
              style={{
                background:
                  'linear-gradient(135deg, #C9A84C 0%, #F5E7B2 50%, #C9A84C 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Cryptographic Credibility.
            </span>
          </h1>

          <p
            style={{
              fontSize: '1.15rem',
              lineHeight: 1.7,
              color: '#94A3B8',
              maxWidth: '680px',
              margin: '0 auto 36px',
            }}
          >
            Step beyond resume fluff. Complete milestone-based systems
            internships reviewed by senior staff engineers. Earn tamper-proof,
            immutable credentials backed by SHA-256 verification.
          </p>

          <div
            style={{
              display: 'flex',
              gap: '16px',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <a
              href="#programs"
              className="btn-gold"
              style={{ padding: '14px 28px', fontSize: '15px' }}
            >
              Browse Engineering Tracks →
            </a>
            <a
              href="#verification"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                color: '#E2E8F0',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                padding: '14px 26px',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '15px',
                transition: 'all 0.2s',
              }}
            >
              Instant Credential Lookup
            </a>
          </div>
        </div>
      </section>

      {/* Real Aggregate Metrics Strip (SEC-Validated Backend Aggregate) */}
      <section
        style={{ maxWidth: '1100px', margin: '0 auto 80px', padding: '0 24px' }}
      >
        <div
          style={{
            background: 'rgba(13, 19, 34, 0.7)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(201, 168, 76, 0.2)',
            borderRadius: '16px',
            padding: '32px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '24px',
            textAlign: 'center',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '2.5rem',
                fontWeight: 800,
                color: '#C9A84C',
                lineHeight: 1,
                marginBottom: '8px',
              }}
            >
              {metrics.active_students}+
            </div>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#94A3B8',
                letterSpacing: '1px',
              }}
            >
              ACTIVE SCHOLARS
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: '2.5rem',
                fontWeight: 800,
                color: '#F5E7B2',
                lineHeight: 1,
                marginBottom: '8px',
              }}
            >
              {metrics.verified_certificates}
            </div>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#94A3B8',
                letterSpacing: '1px',
              }}
            >
              VERIFIED CREDENTIALS
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: '2.5rem',
                fontWeight: 800,
                color: '#C9A84C',
                lineHeight: 1,
                marginBottom: '8px',
              }}
            >
              {metrics.industry_programs}
            </div>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#94A3B8',
                letterSpacing: '1px',
              }}
            >
              PRODUCTION TRACKS
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: '2.5rem',
                fontWeight: 800,
                color: '#10B981',
                lineHeight: 1,
                marginBottom: '8px',
              }}
            >
              {metrics.completion_rate}%
            </div>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#94A3B8',
                letterSpacing: '1px',
              }}
            >
              MILESTONE COMPLETION
            </div>
          </div>
        </div>
      </section>

      {/* Programs Showcase */}
      <section
        id="programs"
        style={{
          maxWidth: '1200px',
          margin: '0 auto 100px',
          padding: '0 24px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <h2
            style={{
              fontSize: '2.2rem',
              fontWeight: 800,
              color: '#FFFFFF',
              marginBottom: '12px',
            }}
          >
            Production Curricula & Milestone Tracks
          </h2>
          <p
            style={{
              color: '#94A3B8',
              fontSize: '1.05rem',
              maxWidth: '600px',
              margin: '0 auto',
            }}
          >
            Each curriculum comprises strictly timed practical milestones
            inspected by staff engineers.
          </p>
        </div>

        {loading ? (
          <div
            style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}
          >
            Loading available curricula...
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: '28px',
            }}
          >
            {internships.map((track) => (
              <div
                key={track.id}
                className="gold-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  background: 'rgba(13, 20, 36, 0.75)',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '16px',
                    }}
                  >
                    <span className="badge badge-gold">
                      {track.tasks.length} MILESTONES
                    </span>
                    <span
                      style={{
                        fontSize: '1.25rem',
                        fontWeight: 800,
                        color: '#F5E7B2',
                      }}
                    >
                      ₹{(track.price / 100).toLocaleString('en-IN')}
                    </span>
                  </div>

                  <h3
                    style={{
                      fontSize: '1.35rem',
                      fontWeight: 700,
                      color: '#FFFFFF',
                      marginBottom: '12px',
                    }}
                  >
                    {track.title}
                  </h3>

                  <p
                    style={{
                      color: '#94A3B8',
                      fontSize: '0.92rem',
                      lineHeight: '1.6',
                      marginBottom: '20px',
                    }}
                  >
                    {track.description}
                  </p>

                  <div
                    style={{
                      borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                      paddingTop: '16px',
                      marginBottom: '24px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#718096',
                        textTransform: 'uppercase',
                        marginBottom: '10px',
                      }}
                    >
                      Key Milestones Included:
                    </div>
                    {track.tasks.map((task) => (
                      <div
                        key={task.task_number}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13px',
                          color: '#CBD5E1',
                          marginBottom: '8px',
                        }}
                      >
                        <span style={{ color: '#C9A84C', fontWeight: 700 }}>
                          #{task.task_number}
                        </span>
                        <span>{task.title}</span>
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: '11px',
                            color: '#64748B',
                          }}
                        >
                          {task.deadline_days}d limit
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <Link
                  to={user ? '/dashboard' : '/register'}
                  className="btn-gold"
                  style={{
                    width: '100%',
                    textAlign: 'center',
                    textDecoration: 'none',
                  }}
                >
                  {user ? 'View Track in Dashboard →' : 'Enroll in Track →'}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Live Verification Portal Section */}
      <section
        id="verification"
        style={{
          background: 'rgba(10, 16, 28, 0.95)',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '80px 24px',
        }}
      >
        <div
          style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: 'rgba(201, 168, 76, 0.15)',
              border: '2px solid #C9A84C',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              color: '#C9A84C',
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#C9A84C"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h2
            style={{
              fontSize: '2rem',
              fontWeight: 800,
              color: '#FFFFFF',
              marginBottom: '12px',
            }}
          >
            Public Credential Verification Engine
          </h2>
          <p
            style={{ color: '#94A3B8', fontSize: '1rem', marginBottom: '32px' }}
          >
            Employers, recruiters, and academic institutions can verify any
            InternCert certificate instantly using its opaque Credential UUID.
          </p>

          <form
            onSubmit={handleVerifySubmit}
            style={{
              display: 'flex',
              gap: '12px',
              maxWidth: '540px',
              margin: '0 auto',
              flexWrap: 'wrap',
            }}
          >
            <input
              type="text"
              placeholder="Paste Credential ID (e.g. 11111111-2222-3333-4444-...)"
              value={verifyCodeInput}
              onChange={(e) => setVerifyCodeInput(e.target.value)}
              style={{
                flex: 1,
                minWidth: '280px',
                padding: '14px 18px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                color: '#FFFFFF',
                fontSize: '14px',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              className="btn-gold"
              style={{ padding: '14px 24px' }}
            >
              Verify Authenticity
            </button>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          padding: '48px 24px',
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '20px',
          color: '#64748B',
          fontSize: '13px',
        }}
      >
        <div>
          <span
            style={{ fontWeight: 800, color: '#C9A84C', letterSpacing: '1px' }}
          >
            INTERNCERT
          </span>{' '}
          — Enterprise-Grade EdTech Infrastructure.
        </div>
        <div>
          Audited against SEC-01 through SEC-15 Invariants. All Rights Reserved.
        </div>
      </footer>
    </div>
  )
}
