import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.js'
import { apiFetch } from '../lib/api.js'
import type {
  StudentEnrollmentView,
  InternshipPublic,
  TaskSubmissionPublic,
  AuditLogEntry,
} from '@interncert/types'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

export function DashboardPage() {
  const { user, logout } = useAuth()

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<
    | 'programs'
    | 'catalog'
    | 'admin-queue'
    | 'admin-mfa'
    | 'admin-actions'
    | 'admin-audit'
  >('programs')

  // Student State
  const [enrollments, setEnrollments] = useState<StudentEnrollmentView[]>([])
  const [catalog, setCatalog] = useState<InternshipPublic[]>([])
  const [loadingEnrollments, setLoadingEnrollments] = useState(true)
  const [selectedEnrollment, setSelectedEnrollment] =
    useState<StudentEnrollmentView | null>(null)
  const [submissions, setSubmissions] = useState<TaskSubmissionPublic[]>([])

  // Task Submission Modal State
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false)
  const [submissionContent, setSubmissionContent] = useState('')
  const [submittingTask, setSubmittingTask] = useState(false)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [submissionSuccess, setSubmissionSuccess] = useState<string | null>(
    null,
  )

  // Enrollment checkout state
  const [enrollingId, setEnrollingId] = useState<string | null>(null)
  const [enrollMessage, setEnrollMessage] = useState<string | null>(null)

  // Admin State
  const [pendingSubmissions, setPendingSubmissions] = useState<
    Array<{
      id: string
      enrollment_id: string
      task_number: number
      status: string
      content: string
      submitted_at: string
    }>
  >([])
  const [reviewModalSub, setReviewModalSub] = useState<{
    id: string
    task_number: number
    content: string
  } | null>(null)
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected'>(
    'approved',
  )
  const [reviewFeedback, setReviewFeedback] = useState('')
  const [reviewing, setReviewing] = useState(false)

  // Admin MFA State
  const [mfaSetupData, setMfaSetupData] = useState<{
    secret: string
    uri: string
    qr_code: string
  } | null>(null)
  const [mfaCodeInput, setMfaCodeInput] = useState('')
  const [mfaStatusMsg, setMfaStatusMsg] = useState<string | null>(null)

  // Admin SEC-15 Actions State
  const [revokeCertId, setRevokeCertId] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeMfaCode, setRevokeMfaCode] = useState('')
  const [actionStatusMsg, setActionStatusMsg] = useState<string | null>(null)

  // Admin Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])

  // Fetch Student Enrollments
  const loadEnrollments = useCallback(async () => {
    try {
      setLoadingEnrollments(true)
      const data = await apiFetch<{ enrollments: StudentEnrollmentView[] }>(
        '/enroll/my',
      )
      setEnrollments(data.enrollments)
      if (data.enrollments.length > 0 && !selectedEnrollment) {
        setSelectedEnrollment(data.enrollments[0])
      }
    } catch {
      // Handle error gracefully
    } finally {
      setLoadingEnrollments(false)
    }
  }, [selectedEnrollment])

  // Fetch Submissions for Selected Enrollment
  const loadSubmissions = useCallback(async (enrollmentId: string) => {
    try {
      const data = await apiFetch<{ submissions: TaskSubmissionPublic[] }>(
        `/tasks/enrollment/${enrollmentId}`,
      )
      setSubmissions(data.submissions)
    } catch {
      setSubmissions([])
    }
  }, [])

  // Fetch Catalog
  const loadCatalog = useCallback(async () => {
    try {
      const data = await apiFetch<{ internships: InternshipPublic[] }>(
        '/internships',
      )
      setCatalog(data.internships)
    } catch {
      setCatalog([])
    }
  }, [])

  // Fetch Admin Pending Submissions
  const loadPendingSubmissions = useCallback(async () => {
    if (user?.role !== 'admin') return
    try {
      const data = await apiFetch<{
        submissions: Array<{
          id: string
          enrollment_id: string
          task_number: number
          status: string
          content: string
          submitted_at: string
        }>
      }>('/admin/submissions/pending')
      setPendingSubmissions(data.submissions)
    } catch {
      setPendingSubmissions([])
    }
  }, [user?.role])

  // Fetch Admin Audit Logs
  const loadAuditLogs = useCallback(async () => {
    if (user?.role !== 'admin') return
    try {
      const data = await apiFetch<{ logs: AuditLogEntry[] }>(
        '/admin/audit-logs?limit=50',
      )
      setAuditLogs(data.logs)
    } catch {
      setAuditLogs([])
    }
  }, [user?.role])

  useEffect(() => {
    void loadEnrollments()
    void loadCatalog()
    if (user?.role === 'admin') {
      void loadPendingSubmissions()
      void loadAuditLogs()
    }
  }, [
    loadEnrollments,
    loadCatalog,
    loadPendingSubmissions,
    loadAuditLogs,
    user?.role,
  ])

  useEffect(() => {
    if (selectedEnrollment) {
      void loadSubmissions(selectedEnrollment.id)
    }
  }, [selectedEnrollment, loadSubmissions])

  // Handle Task Submission
  const handleSubmitTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEnrollment) return

    if (submissionContent.trim().length < 5) {
      setSubmissionError('Submission content must be at least 5 characters.')
      return
    }

    try {
      setSubmittingTask(true)
      setSubmissionError(null)
      await apiFetch('/tasks/submit', {
        method: 'POST',
        data: {
          enrollment_id: selectedEnrollment.id,
          content: submissionContent.trim(),
        },
      })

      setSubmissionSuccess(
        'Task submitted successfully! Awaiting staff review.',
      )
      setSubmissionContent('')
      setTimeout(() => {
        setIsSubmitModalOpen(false)
        setSubmissionSuccess(null)
      }, 1500)

      void loadSubmissions(selectedEnrollment.id)
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : 'Failed to submit task. Please check requirements.'
      setSubmissionError(errorMsg)
    } finally {
      setSubmittingTask(false)
    }
  }

  // Handle Enrollment Checkout
  const handleEnrollClick = async (internshipId: string) => {
    try {
      setEnrollingId(internshipId)
      setEnrollMessage(null)

      // Step 1: Create Order
      const order = await apiFetch<{
        order_id: string
        amount: number
        currency: string
      }>('/enroll/order', {
        method: 'POST',
        data: { internship_id: internshipId },
      })

      // Step 2: Auto-verify in development/mock mode
      await apiFetch('/enroll/verify', {
        method: 'POST',
        data: {
          razorpay_order_id: order.order_id,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: 'dev_mock_signature_captured',
        },
      })

      setEnrollMessage(
        'Enrollment activated! Redirecting to your milestones...',
      )
      await loadEnrollments()
      setActiveTab('programs')
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : 'Enrollment failed. You may already be enrolled.'
      setEnrollMessage(errorMsg)
    } finally {
      setEnrollingId(null)
    }
  }

  // Handle Admin Review Submission
  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reviewModalSub) return

    try {
      setReviewing(true)
      await apiFetch(`/admin/submissions/${reviewModalSub.id}/review`, {
        method: 'POST',
        data: {
          decision: reviewDecision,
          feedback: reviewFeedback.trim() || undefined,
        },
      })

      setReviewModalSub(null)
      setReviewFeedback('')
      void loadPendingSubmissions()
      void loadEnrollments()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Review failed')
    } finally {
      setReviewing(false)
    }
  }

  // Admin MFA Setup
  const handleInitiateMfa = async () => {
    try {
      const data = await apiFetch<{
        secret: string
        uri: string
        qr_code: string
      }>('/admin/mfa/setup', { method: 'POST' })
      setMfaSetupData(data)
      setMfaStatusMsg(
        'Scan this QR code with Google Authenticator or 1Password.',
      )
    } catch {
      setMfaStatusMsg('Failed to initiate MFA setup.')
    }
  }

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await apiFetch('/admin/mfa/verify', {
        method: 'POST',
        data: { totp_code: mfaCodeInput.trim() },
      })
      setMfaStatusMsg(
        'MFA successfully verified and active on your admin account!',
      )
      setMfaSetupData(null)
      setMfaCodeInput('')
    } catch {
      setMfaStatusMsg(
        'Invalid 6-digit code. Please verify time synchronization.',
      )
    }
  }

  // Admin SEC-15 Revocation
  const handleRevokeCertificate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setActionStatusMsg(null)
      await apiFetch(
        `/admin/certificates/${encodeURIComponent(revokeCertId.trim())}/revoke`,
        {
          method: 'POST',
          headers: {
            'x-mfa-code': revokeMfaCode.trim(),
          },
          data: {
            reason: revokeReason.trim(),
          },
        },
      )
      setActionStatusMsg(
        'Certificate successfully revoked with SEC-15 audit logging.',
      )
      setRevokeCertId('')
      setRevokeReason('')
      setRevokeMfaCode('')
      void loadAuditLogs()
    } catch (err: unknown) {
      setActionStatusMsg(
        err instanceof Error
          ? err.message
          : 'Revocation failed. Ensure MFA code is valid.',
      )
    }
  }

  if (!user) return null

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
      {/* Platform Header */}
      <header
        style={{
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundColor: 'rgba(11, 15, 25, 0.9)',
          backdropFilter: 'blur(12px)',
          padding: '16px 24px',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <Link
              to="/"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                textDecoration: 'none',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '6px',
                  background:
                    'linear-gradient(135deg, #C9A84C 0%, #F5E7B2 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#070D18"
                  strokeWidth="2.5"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <span
                style={{
                  fontWeight: 800,
                  fontSize: '1.2rem',
                  letterSpacing: '1px',
                  color: '#C9A84C',
                }}
              >
                INTERNCERT
              </span>
            </Link>
            <span
              style={{
                fontSize: '12px',
                color: '#64748B',
                paddingLeft: '12px',
                borderLeft: '1px solid #1E293B',
              }}
            >
              {user.role === 'admin' ? 'COMMAND CONSOLE' : 'SCHOLAR PORTAL'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              {user.email}
            </span>
            <span
              className={`badge ${user.role === 'admin' ? 'badge-gold' : 'badge-approved'}`}
            >
              {user.role}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#CBD5E1',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main
        style={{ maxWidth: '1280px', margin: '32px auto', padding: '0 24px' }}
      >
        {/* Navigation Tabs */}
        <div className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${activeTab === 'programs' ? 'active' : ''}`}
            onClick={() => setActiveTab('programs')}
          >
            📂 My Milestones & Credentials
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'catalog' ? 'active' : ''}`}
            onClick={() => setActiveTab('catalog')}
          >
            ⚡ Explore Engineering Tracks
          </button>

          {user.role === 'admin' && (
            <>
              <button
                type="button"
                className={`nav-tab ${activeTab === 'admin-queue' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('admin-queue')
                  void loadPendingSubmissions()
                }}
              >
                📥 Review Queue ({pendingSubmissions.length})
              </button>
              <button
                type="button"
                className={`nav-tab ${activeTab === 'admin-mfa' ? 'active' : ''}`}
                onClick={() => setActiveTab('admin-mfa')}
              >
                🛡️ MFA Security
              </button>
              <button
                type="button"
                className={`nav-tab ${activeTab === 'admin-actions' ? 'active' : ''}`}
                onClick={() => setActiveTab('admin-actions')}
              >
                🔐 SEC-15 Actions
              </button>
              <button
                type="button"
                className={`nav-tab ${activeTab === 'admin-audit' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('admin-audit')
                  void loadAuditLogs()
                }}
              >
                📜 Audit Logs
              </button>
            </>
          )}
        </div>

        {/* TAB 1: Student Active Programs & Milestones */}
        {activeTab === 'programs' && (
          <div>
            {loadingEnrollments ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '48px 0',
                  color: '#94A3B8',
                }}
              >
                Loading your enrolled programs...
              </div>
            ) : enrollments.length === 0 ? (
              <div
                className="gold-card"
                style={{
                  textAlign: 'center',
                  padding: '48px 24px',
                  maxWidth: '600px',
                  margin: '40px auto',
                }}
              >
                <h3
                  style={{
                    fontSize: '1.4rem',
                    color: '#FFFFFF',
                    marginBottom: '8px',
                  }}
                >
                  No Active Enrollments
                </h3>
                <p
                  style={{
                    color: '#94A3B8',
                    fontSize: '0.95rem',
                    marginBottom: '24px',
                  }}
                >
                  You haven't enrolled in an engineering track yet. Browse our
                  verified curricula to begin.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('catalog')}
                  className="btn-gold"
                >
                  Browse Curricula Now →
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '320px 1fr',
                  gap: '28px',
                }}
              >
                {/* Left Column: Enrollment Selector */}
                <div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#64748B',
                      textTransform: 'uppercase',
                      marginBottom: '12px',
                    }}
                  >
                    Your Enrolled Tracks
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    {enrollments.map((e) => {
                      const isSelected = selectedEnrollment?.id === e.id
                      return (
                        <div
                          key={e.id}
                          onClick={() => setSelectedEnrollment(e)}
                          style={{
                            padding: '16px',
                            borderRadius: '10px',
                            backgroundColor: isSelected
                              ? 'rgba(201, 168, 76, 0.12)'
                              : 'rgba(15, 23, 42, 0.6)',
                            border: isSelected
                              ? '1px solid #C9A84C'
                              : '1px solid rgba(255, 255, 255, 0.08)',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              marginBottom: '6px',
                            }}
                          >
                            <span
                              className={`badge ${e.completed_at ? 'badge-gold' : 'badge-active'}`}
                            >
                              {e.completed_at ? 'completed' : e.status}
                            </span>
                            <span
                              style={{ fontSize: '12px', color: '#64748B' }}
                            >
                              Task #{e.current_task}
                            </span>
                          </div>
                          <div
                            style={{
                              fontWeight: 700,
                              color: '#F8FAFC',
                              fontSize: '0.95rem',
                            }}
                          >
                            {e.internship?.title || 'Internship Program'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Right Column: Selected Enrollment Workspace */}
                {selectedEnrollment && (
                  <div>
                    {/* Completion / Certificate Banner */}
                    {selectedEnrollment.completed_at &&
                      selectedEnrollment.certificate && (
                        <div
                          className="gold-card"
                          style={{
                            marginBottom: '24px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '16px',
                          }}
                        >
                          <div>
                            <span
                              className="badge badge-gold"
                              style={{ marginBottom: '8px' }}
                            >
                              🎓 COMPLETED & VERIFIED
                            </span>
                            <h3
                              style={{
                                fontSize: '1.3rem',
                                color: '#FFFFFF',
                                margin: 0,
                              }}
                            >
                              Official Certificate Issued
                            </h3>
                            <p
                              style={{
                                color: '#94A3B8',
                                fontSize: '0.9rem',
                                marginTop: '4px',
                              }}
                            >
                              Credential ID:{' '}
                              <code>
                                {
                                  selectedEnrollment.certificate
                                    .verification_code
                                }
                              </code>
                            </p>
                          </div>
                          <div style={{ display: 'flex', gap: '12px' }}>
                            <Link
                              to={`/verify/${selectedEnrollment.certificate.verification_code}`}
                              className="btn-gold"
                              style={{ fontSize: '13px' }}
                            >
                              View Registry Record
                            </Link>
                            <a
                              href={`${API_BASE_URL}/verify/${selectedEnrollment.certificate.verification_code}/pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                color: '#FFFFFF',
                                padding: '10px 16px',
                                borderRadius: '6px',
                                textDecoration: 'none',
                                fontSize: '13px',
                                fontWeight: 600,
                              }}
                            >
                              Download PDF
                            </a>
                          </div>
                        </div>
                      )}

                    {/* Milestone Progress Card */}
                    <div
                      style={{
                        backgroundColor: 'rgba(13, 20, 36, 0.7)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '12px',
                        padding: '24px',
                        marginBottom: '28px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '16px',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: 700,
                              color: '#C9A84C',
                              letterSpacing: '1px',
                            }}
                          >
                            CURRENT MILESTONE
                          </div>
                          <h2
                            style={{
                              fontSize: '1.4rem',
                              color: '#FFFFFF',
                              margin: '4px 0 0',
                            }}
                          >
                            Milestone #{selectedEnrollment.current_task}
                          </h2>
                        </div>
                        {selectedEnrollment.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => setIsSubmitModalOpen(true)}
                            className="btn-gold"
                          >
                            Submit Milestone Solution →
                          </button>
                        )}
                      </div>

                      <p
                        style={{
                          color: '#94A3B8',
                          fontSize: '0.95rem',
                          lineHeight: '1.6',
                        }}
                      >
                        Build and test your milestone code. Submissions undergo
                        rigorous automated invariant verification and senior
                        engineer review.
                      </p>

                      <div
                        style={{
                          display: 'flex',
                          gap: '20px',
                          marginTop: '16px',
                          fontSize: '13px',
                          color: '#64748B',
                        }}
                      >
                        <span>
                          Start:{' '}
                          {new Date(
                            selectedEnrollment.start_date,
                          ).toLocaleDateString()}
                        </span>
                        <span>
                          Deadline:{' '}
                          {new Date(
                            selectedEnrollment.end_date,
                          ).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {/* Submissions History */}
                    <div>
                      <h4
                        style={{
                          fontSize: '1.1rem',
                          color: '#FFFFFF',
                          marginBottom: '16px',
                        }}
                      >
                        Milestone Review History
                      </h4>

                      {submissions.length === 0 ? (
                        <div
                          style={{
                            color: '#64748B',
                            fontSize: '0.9rem',
                            padding: '16px 0',
                          }}
                        >
                          No submissions recorded yet for this enrollment.
                        </div>
                      ) : (
                        <div className="data-table-wrapper">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Milestone</th>
                                <th>Status</th>
                                <th>Submitted</th>
                                <th>Feedback</th>
                              </tr>
                            </thead>
                            <tbody>
                              {submissions.map((sub) => (
                                <tr key={sub.id}>
                                  <td
                                    style={{
                                      fontWeight: 700,
                                      color: '#F8FAFC',
                                    }}
                                  >
                                    #{sub.task_number}
                                  </td>
                                  <td>
                                    <span
                                      className={`badge ${
                                        sub.status === 'approved'
                                          ? 'badge-approved'
                                          : sub.status === 'rejected'
                                            ? 'badge-rejected'
                                            : 'badge-pending'
                                      }`}
                                    >
                                      {sub.status}
                                    </span>
                                  </td>
                                  <td>
                                    {new Date(
                                      sub.submitted_at,
                                    ).toLocaleDateString()}
                                  </td>
                                  <td
                                    style={{
                                      color: sub.feedback
                                        ? '#CBD5E1'
                                        : '#64748B',
                                    }}
                                  >
                                    {sub.feedback ||
                                      'Pending mentor inspection'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Catalog & Checkout */}
        {activeTab === 'catalog' && (
          <div>
            <div style={{ marginBottom: '24px' }}>
              <h2
                style={{
                  fontSize: '1.6rem',
                  color: '#FFFFFF',
                  marginBottom: '8px',
                }}
              >
                Verified Engineering Curricula
              </h2>
              <p style={{ color: '#94A3B8', fontSize: '0.95rem' }}>
                Enroll into specialized milestone tracks designed to mirror
                senior-level production environments.
              </p>
            </div>

            {enrollMessage && (
              <div
                style={{
                  backgroundColor: 'rgba(201, 168, 76, 0.15)',
                  border: '1px solid #C9A84C',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  color: '#F5E7B2',
                  marginBottom: '20px',
                }}
              >
                {enrollMessage}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '24px',
              }}
            >
              {catalog.map((track) => (
                <div
                  key={track.id}
                  className="gold-card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '12px',
                      }}
                    >
                      <span className="badge badge-gold">
                        {track.tasks.length} MILESTONES
                      </span>
                      <span
                        style={{
                          fontWeight: 800,
                          color: '#F5E7B2',
                          fontSize: '1.2rem',
                        }}
                      >
                        ₹{(track.price / 100).toLocaleString('en-IN')}
                      </span>
                    </div>
                    <h3
                      style={{
                        fontSize: '1.25rem',
                        color: '#FFFFFF',
                        marginBottom: '8px',
                      }}
                    >
                      {track.title}
                    </h3>
                    <p
                      style={{
                        color: '#94A3B8',
                        fontSize: '0.9rem',
                        lineHeight: '1.6',
                        marginBottom: '20px',
                      }}
                    >
                      {track.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleEnrollClick(track.id)}
                    disabled={enrollingId === track.id}
                    className="btn-gold"
                    style={{ width: '100%' }}
                  >
                    {enrollingId === track.id
                      ? 'Securing Seat...'
                      : 'Enroll & Begin Track →'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: Admin Review Queue */}
        {activeTab === 'admin-queue' && user.role === 'admin' && (
          <div>
            <div style={{ marginBottom: '24px' }}>
              <h2
                style={{
                  fontSize: '1.6rem',
                  color: '#FFFFFF',
                  marginBottom: '8px',
                }}
              >
                Pending Milestone Submissions ({pendingSubmissions.length})
              </h2>
              <p style={{ color: '#94A3B8', fontSize: '0.95rem' }}>
                Evaluate student work against technical standards. Approvals
                atomically increment the student's milestone index.
              </p>
            </div>

            {pendingSubmissions.length === 0 ? (
              <div
                style={{
                  color: '#64748B',
                  textAlign: 'center',
                  padding: '60px 0',
                }}
              >
                All pending submissions reviewed! The queue is clean.
              </div>
            ) : (
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Task #</th>
                      <th>Enrollment ID</th>
                      <th>Submitted Code / Notes</th>
                      <th>Timestamp</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingSubmissions.map((sub) => (
                      <tr key={sub.id}>
                        <td style={{ fontWeight: 700, color: '#C9A84C' }}>
                          #{sub.task_number}
                        </td>
                        <td>
                          <code>{sub.enrollment_id}</code>
                        </td>
                        <td
                          style={{
                            maxWidth: '320px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {sub.content}
                        </td>
                        <td>
                          {new Date(sub.submitted_at).toLocaleTimeString()}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => {
                              setReviewModalSub(sub)
                              setReviewFeedback('')
                            }}
                            className="btn-gold"
                            style={{ padding: '6px 12px', fontSize: '12px' }}
                          >
                            Review Work
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Admin MFA Setup */}
        {activeTab === 'admin-mfa' && user.role === 'admin' && (
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            <div className="gold-card">
              <h3
                style={{
                  fontSize: '1.3rem',
                  color: '#FFFFFF',
                  marginBottom: '8px',
                }}
              >
                Multi-Factor Authentication (TOTP)
              </h3>
              <p
                style={{
                  color: '#94A3B8',
                  fontSize: '0.9rem',
                  marginBottom: '24px',
                  lineHeight: '1.6',
                }}
              >
                High-risk administrative actions (certificate revocation,
                refunds) require fresh TOTP verification codes to prevent
                unauthorized mutations.
              </p>

              {mfaStatusMsg && (
                <div
                  style={{
                    backgroundColor: 'rgba(201, 168, 76, 0.15)',
                    border: '1px solid #C9A84C',
                    borderRadius: '6px',
                    padding: '12px',
                    color: '#F5E7B2',
                    fontSize: '13px',
                    marginBottom: '20px',
                  }}
                >
                  {mfaStatusMsg}
                </div>
              )}

              {!mfaSetupData ? (
                <button
                  type="button"
                  onClick={() => void handleInitiateMfa()}
                  className="btn-gold"
                >
                  Configure New TOTP Device →
                </button>
              ) : (
                <div>
                  <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <img
                      src={mfaSetupData.qr_code}
                      alt="TOTP QR Code"
                      style={{
                        borderRadius: '8px',
                        border: '2px solid #C9A84C',
                      }}
                    />
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#64748B',
                        marginTop: '8px',
                        fontFamily: 'monospace',
                      }}
                    >
                      Secret: {mfaSetupData.secret}
                    </div>
                  </div>

                  <form
                    onSubmit={handleVerifyMfa}
                    style={{ display: 'flex', gap: '12px' }}
                  >
                    <input
                      type="text"
                      placeholder="Enter 6-digit TOTP code"
                      maxLength={6}
                      value={mfaCodeInput}
                      onChange={(e) => setMfaCodeInput(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '10px 14px',
                        borderRadius: '6px',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        backgroundColor: 'rgba(15, 23, 42, 0.8)',
                        color: '#FFFFFF',
                        textAlign: 'center',
                        fontSize: '18px',
                        letterSpacing: '4px',
                      }}
                    />
                    <button type="submit" className="btn-gold">
                      Verify & Activate
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: Admin SEC-15 Actions */}
        {activeTab === 'admin-actions' && user.role === 'admin' && (
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            <div className="gold-card">
              <h3
                style={{
                  fontSize: '1.3rem',
                  color: '#FFFFFF',
                  marginBottom: '8px',
                }}
              >
                SEC-15 Certificate Revocation (MFA Protected)
              </h3>
              <p
                style={{
                  color: '#94A3B8',
                  fontSize: '0.9rem',
                  marginBottom: '24px',
                  lineHeight: '1.6',
                }}
              >
                Revoking a certificate immediately invalidates its registry
                entry, blocks PDF downloads, and appends an immutable audit log
                row.
              </p>

              {actionStatusMsg && (
                <div
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid #EF4444',
                    borderRadius: '6px',
                    padding: '12px',
                    color: '#FCA5A5',
                    fontSize: '13px',
                    marginBottom: '20px',
                  }}
                >
                  {actionStatusMsg}
                </div>
              )}

              <form
                onSubmit={handleRevokeCertificate}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: '#CBD5E1',
                      marginBottom: '6px',
                    }}
                  >
                    Certificate Credential ID
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 11111111-2222-3333-4444-555555555555"
                    value={revokeCertId}
                    onChange={(e) => setRevokeCertId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      backgroundColor: 'rgba(15, 23, 42, 0.8)',
                      color: '#FFFFFF',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: '#CBD5E1',
                      marginBottom: '6px',
                    }}
                  >
                    Revocation Justification (Recorded in AuditLog)
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder="Reason for revocation..."
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      backgroundColor: 'rgba(15, 23, 42, 0.8)',
                      color: '#FFFFFF',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: '#CBD5E1',
                      marginBottom: '6px',
                    }}
                  >
                    Step-Up TOTP Code (6 Digits)
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="000000"
                    value={revokeMfaCode}
                    onChange={(e) => setRevokeMfaCode(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      backgroundColor: 'rgba(15, 23, 42, 0.8)',
                      color: '#FFFFFF',
                      letterSpacing: '2px',
                    }}
                  />
                </div>

                <button
                  type="submit"
                  style={{
                    backgroundColor: '#DC2626',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginTop: '8px',
                  }}
                >
                  Confirm Certificate Revocation (SEC-15)
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 6: Admin Immutable Audit Logs */}
        {activeTab === 'admin-audit' && user.role === 'admin' && (
          <div>
            <div style={{ marginBottom: '24px' }}>
              <h2
                style={{
                  fontSize: '1.6rem',
                  color: '#FFFFFF',
                  marginBottom: '8px',
                }}
              >
                Immutable Audit Trail (Append-Only)
              </h2>
              <p style={{ color: '#94A3B8', fontSize: '0.95rem' }}>
                All administrative mutations are persisted with cryptographic
                actor identification, IP logging, and request IDs.
              </p>
            </div>

            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Target Type</th>
                    <th>Target ID</th>
                    <th>Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.created_at).toLocaleString()}</td>
                      <td>
                        <span className="badge badge-gold">{log.action}</span>
                      </td>
                      <td>{log.target_type}</td>
                      <td>
                        <code>{log.target_id}</code>
                      </td>
                      <td>
                        <code>{log.admin_id}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Task Submission Modal */}
      {isSubmitModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.25rem', color: '#FFFFFF', margin: 0 }}>
                Submit Milestone Work
              </h3>
              <button
                type="button"
                onClick={() => setIsSubmitModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748B',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {submissionError && (
              <div
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: '#F87171',
                  padding: '10px',
                  borderRadius: '6px',
                  marginBottom: '16px',
                  fontSize: '13px',
                }}
              >
                {submissionError}
              </div>
            )}

            {submissionSuccess && (
              <div
                style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#34D399',
                  padding: '10px',
                  borderRadius: '6px',
                  marginBottom: '16px',
                  fontSize: '13px',
                }}
              >
                {submissionSuccess}
              </div>
            )}

            <form onSubmit={handleSubmitTask}>
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '8px',
                  }}
                >
                  Solution Notes & Repository Link
                </label>
                <textarea
                  rows={6}
                  required
                  placeholder="Provide your solution architecture details, GitHub PR link, and milestone verification tests..."
                  value={submissionContent}
                  onChange={(e) => setSubmissionContent(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#FFFFFF',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '12px',
                }}
              >
                <button
                  type="button"
                  onClick={() => setIsSubmitModalOpen(false)}
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#CBD5E1',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingTask}
                  className="btn-gold"
                >
                  {submittingTask ? 'Submitting...' : 'Confirm Submission'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Review Modal */}
      {reviewModalSub && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.25rem', color: '#FFFFFF', margin: 0 }}>
                Review Milestone #{reviewModalSub.task_number}
              </h3>
              <button
                type="button"
                onClick={() => setReviewModalSub(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748B',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                backgroundColor: '#070D18',
                padding: '12px',
                borderRadius: '6px',
                marginBottom: '20px',
                fontSize: '13px',
                color: '#CBD5E1',
                maxHeight: '150px',
                overflowY: 'auto',
              }}
            >
              <strong>Submitted Content:</strong>
              <p style={{ marginTop: '6px', whiteSpace: 'pre-wrap' }}>
                {reviewModalSub.content}
              </p>
            </div>

            <form onSubmit={handleReviewSubmit}>
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '8px',
                  }}
                >
                  Decision
                </label>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    type="button"
                    onClick={() => setReviewDecision('approved')}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '6px',
                      border:
                        reviewDecision === 'approved'
                          ? '2px solid #10B981'
                          : '1px solid #1E293B',
                      backgroundColor:
                        reviewDecision === 'approved'
                          ? 'rgba(16, 185, 129, 0.2)'
                          : 'transparent',
                      color: '#FFFFFF',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ✓ Approve Work
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewDecision('rejected')}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '6px',
                      border:
                        reviewDecision === 'rejected'
                          ? '2px solid #EF4444'
                          : '1px solid #1E293B',
                      backgroundColor:
                        reviewDecision === 'rejected'
                          ? 'rgba(239, 68, 68, 0.2)'
                          : 'transparent',
                      color: '#FFFFFF',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ✕ Request Rework
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '8px',
                  }}
                >
                  Mentor Feedback
                </label>
                <textarea
                  rows={3}
                  placeholder="Provide technical feedback or code recommendations..."
                  value={reviewFeedback}
                  onChange={(e) => setReviewFeedback(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#FFFFFF',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '12px',
                }}
              >
                <button
                  type="button"
                  onClick={() => setReviewModalSub(null)}
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#CBD5E1',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button type="submit" disabled={reviewing} className="btn-gold">
                  {reviewing ? 'Submitting...' : 'Commit Review Decision'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
