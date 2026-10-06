import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { VerifyCertificateResponse } from '@interncert/types'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

export function VerifyCertificatePage() {
  const { code } = useParams<{ code: string }>()
  const [loading, setLoading] = useState(true)
  const [certificate, setCertificate] =
    useState<VerifyCertificateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadCertificate() {
      if (!code) {
        setError('No credential code provided.')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)
        const res = await fetch(
          `${API_BASE_URL}/verify/${encodeURIComponent(code)}`,
          {
            headers: { Accept: 'application/json' },
          },
        )

        if (!res.ok) {
          if (res.status === 404) {
            setError(
              'No authentic certificate was found matching this credential ID.',
            )
          } else {
            setError('Failed to verify certificate. Please try again later.')
          }
          setCertificate(null)
          return
        }

        const data = (await res.json()) as VerifyCertificateResponse
        setCertificate(data)
      } catch {
        setError('Network error occurred while verifying certificate.')
        setCertificate(null)
      } finally {
        setLoading(false)
      }
    }

    void loadCertificate()
  }, [code])

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#070D18',
        color: '#E2E8F0',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '2rem 1rem',
      }}
    >
      {/* Brand Header */}
      <header
        style={{
          width: '100%',
          maxWidth: '800px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2.5rem',
        }}
      >
        <Link
          to="/"
          style={{
            color: '#C9A84C',
            fontWeight: 800,
            fontSize: '1.25rem',
            textDecoration: 'none',
            letterSpacing: '2px',
          }}
        >
          INTERNCERT
        </Link>
        <div
          style={{
            fontSize: '0.85rem',
            color: '#718096',
            letterSpacing: '0.5px',
          }}
        >
          SECURE CREDENTIAL REGISTRY
        </div>
      </header>

      {/* Main Content Box */}
      <main
        style={{
          width: '100%',
          maxWidth: '720px',
          backgroundColor: '#0A1628',
          border: '1px solid #1E293B',
          borderRadius: '12px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Banner Top */}
        <div
          style={{
            height: '6px',
            background:
              'linear-gradient(90deg, #C9A84C 0%, #F5E7B2 50%, #C9A84C 100%)',
          }}
        />

        <div style={{ padding: '2.5rem' }}>
          {loading ? (
            <div
              style={{
                textAlign: 'center',
                padding: '3rem 0',
                color: '#A0AEC0',
              }}
            >
              <div
                style={{
                  display: 'inline-block',
                  width: '40px',
                  height: '40px',
                  border: '3px solid #1E293B',
                  borderTopColor: '#C9A84C',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  marginBottom: '1rem',
                }}
              />
              <p>
                Verifying cryptographic credential on InternCert registry...
              </p>
            </div>
          ) : error || !certificate ? (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: '#EF4444',
                  fontSize: '2rem',
                  marginBottom: '1rem',
                }}
              >
                ✕
              </div>
              <h2
                style={{
                  color: '#EF4444',
                  fontSize: '1.5rem',
                  marginBottom: '0.75rem',
                }}
              >
                Verification Failed
              </h2>
              <p
                style={{
                  color: '#A0AEC0',
                  maxWidth: '460px',
                  margin: '0 auto 1.5rem',
                  lineHeight: '1.6',
                }}
              >
                {error ||
                  'The certificate code provided is not authentic or has expired.'}
              </p>
              <div
                style={{
                  fontSize: '0.85rem',
                  color: '#64748B',
                  backgroundColor: '#0F1E36',
                  padding: '0.75rem 1rem',
                  borderRadius: '6px',
                  display: 'inline-block',
                  fontFamily: 'monospace',
                }}
              >
                Queried ID: {code || 'N/A'}
              </div>
            </div>
          ) : (
            <div>
              {/* Verified Badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid #1E293B',
                  paddingBottom: '1.5rem',
                  marginBottom: '2rem',
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}
                >
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      backgroundColor:
                        certificate.status === 'revoked'
                          ? 'rgba(239, 68, 68, 0.15)'
                          : 'rgba(201, 168, 76, 0.15)',
                      border:
                        certificate.status === 'revoked'
                          ? '2px solid #EF4444'
                          : '2px solid #C9A84C',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color:
                        certificate.status === 'revoked'
                          ? '#EF4444'
                          : '#C9A84C',
                      fontWeight: 800,
                      fontSize: '1.25rem',
                    }}
                  >
                    {certificate.status === 'revoked' ? '✕' : '✓'}
                  </div>
                  <div>
                    <span
                      style={{
                        display: 'inline-block',
                        backgroundColor:
                          certificate.status === 'revoked'
                            ? '#7F1D1D'
                            : '#064E3B',
                        color:
                          certificate.status === 'revoked'
                            ? '#FCA5A5'
                            : '#6EE7B7',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        letterSpacing: '1px',
                        marginBottom: '0.25rem',
                      }}
                    >
                      {certificate.status === 'revoked'
                        ? 'REVOKED'
                        : 'VERIFIED AUTHENTIC'}
                    </span>
                    <h1
                      style={{
                        fontSize: '1.25rem',
                        margin: 0,
                        color: '#FFFFFF',
                        fontWeight: 600,
                      }}
                    >
                      Certificate of Completion
                    </h1>
                  </div>
                </div>

                {certificate.status !== 'revoked' && (
                  <a
                    href={`${API_BASE_URL}/verify/${certificate.verification_code}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      backgroundColor: '#C9A84C',
                      color: '#0A1628',
                      textDecoration: 'none',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      padding: '0.6rem 1.2rem',
                      borderRadius: '6px',
                      boxShadow: '0 4px 12px rgba(201,168,76,0.2)',
                    }}
                  >
                    Download PDF
                  </a>
                )}
              </div>

              {certificate.status === 'revoked' && (
                <div
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid #EF4444',
                    borderRadius: '8px',
                    padding: '1rem',
                    color: '#FCA5A5',
                    marginBottom: '1.5rem',
                    fontSize: '0.9rem',
                  }}
                >
                  <strong>REVOCATION NOTICE:</strong> This certificate was
                  officially revoked by InternCert.
                  {certificate.revoked_reason && (
                    <div style={{ marginTop: '0.35rem' }}>
                      Reason: {certificate.revoked_reason}
                    </div>
                  )}
                </div>
              )}

              {/* Certificate Details Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '1.5rem',
                  marginBottom: '2rem',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: '#718096',
                      marginBottom: '0.35rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Recipient
                  </div>
                  <div
                    style={{
                      fontSize: '1.2rem',
                      fontWeight: 700,
                      color: '#F8FAFC',
                    }}
                  >
                    {certificate.student_name}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: '#718096',
                      marginBottom: '0.35rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Program
                  </div>
                  <div
                    style={{
                      fontSize: '1.2rem',
                      fontWeight: 700,
                      color: '#C9A84C',
                    }}
                  >
                    {certificate.internship_title}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: '#718096',
                      marginBottom: '0.35rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Issue Date
                  </div>
                  <div style={{ fontSize: '1rem', color: '#E2E8F0' }}>
                    {new Date(certificate.issued_at).toLocaleDateString(
                      'en-US',
                      {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      },
                    )}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: '#718096',
                      marginBottom: '0.35rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Credential ID
                  </div>
                  <div
                    style={{
                      fontSize: '0.9rem',
                      color: '#CBD5E1',
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                    }}
                  >
                    {certificate.verification_code}
                  </div>
                </div>
              </div>

              {/* Verification Statement */}
              <div
                style={{
                  backgroundColor: '#0F1E36',
                  border: '1px solid #1E293B',
                  borderRadius: '8px',
                  padding: '1.25rem',
                  fontSize: '0.85rem',
                  lineHeight: '1.6',
                  color: '#94A3B8',
                }}
              >
                <strong style={{ color: '#E2E8F0' }}>
                  Official Record Verification:
                </strong>{' '}
                This document confirms that the individual named above has
                successfully completed all required milestones, practical tasks,
                and technical assessments for this internship program under the
                supervision of InternCert mentors.
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer
        style={{
          marginTop: '3rem',
          fontSize: '0.8rem',
          color: '#64748B',
          textAlign: 'center',
        }}
      >
        © {new Date().getFullYear()} InternCert Platform. All certificates are
        cryptographically signed and logged.
      </footer>
    </div>
  )
}
