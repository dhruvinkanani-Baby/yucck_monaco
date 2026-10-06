import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import { app } from '../app.js'
import { User, type IUser } from '../models/User.js'
import { Internship, type IInternship } from '../models/Internship.js'
import { Enrollment, type IEnrollment } from '../models/Enrollment.js'
import {
  TaskSubmission,
  type ITaskSubmission,
} from '../models/TaskSubmission.js'
import { AuditLog, type IAuditLog } from '../models/AuditLog.js'
import { expirePastDueEnrollments } from '../workers/enrollmentExpirationWorker.js'
import { signSessionToken } from '../middleware/auth.js'

describe('Step 6 — Task Workflow & SEC-12 Concurrency Gates', () => {
  interface MockUser {
    _id: mongoose.Types.ObjectId
    email: string
    role: 'student' | 'admin'
    session_version: number
  }

  interface MockInternship {
    _id: mongoose.Types.ObjectId
    title: string
    tasks: Array<{
      task_number: number
      title: string
      description: string
      deadline_days: number
    }>
  }

  interface MockEnrollment {
    _id: mongoose.Types.ObjectId
    user_id: mongoose.Types.ObjectId
    internship_id: mongoose.Types.ObjectId
    status: 'active' | 'expired' | 'completed'
    current_task: number
    start_date: Date
    end_date: Date
    completed_at?: Date | null
  }

  interface MockSubmission {
    _id: mongoose.Types.ObjectId
    enrollment_id: mongoose.Types.ObjectId
    task_number: number
    status: 'pending' | 'approved' | 'rejected'
    content: string
    feedback?: string | null
    submitted_at: Date
    reviewed_at?: Date | null
    reviewed_by?: mongoose.Types.ObjectId | null
  }

  interface MockAuditLog {
    _id: mongoose.Types.ObjectId
    admin_id: mongoose.Types.ObjectId
    action: string
    target_type: string
    target_id: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  }

  const usersStore = new Map<string, MockUser>()
  const internshipsStore = new Map<string, MockInternship>()
  const enrollmentsStore = new Map<string, MockEnrollment>()
  const submissionsStore = new Map<string, MockSubmission>()
  const auditLogsStore = new Map<string, MockAuditLog>()

  const studentAId = new mongoose.Types.ObjectId()
  const studentBId = new mongoose.Types.ObjectId()
  const adminId = new mongoose.Types.ObjectId()
  const internshipId = new mongoose.Types.ObjectId()

  function getAuthCookie(
    userId: mongoose.Types.ObjectId,
    role: 'student' | 'admin' = 'student',
  ) {
    const token = signSessionToken(
      { _id: userId, role, session_version: 1 },
      role,
    )
    return `session=${token}`
  }

  const csrfToken = 'test-valid-csrf-token-1234567890123456'
  const csrfCookie = `csrf_token=${csrfToken}`

  beforeEach(() => {
    usersStore.clear()
    internshipsStore.clear()
    enrollmentsStore.clear()
    submissionsStore.clear()
    auditLogsStore.clear()

    // Seed users
    usersStore.set(studentAId.toString(), {
      _id: studentAId,
      email: 'student_a@example.com',
      role: 'student',
      session_version: 1,
    })
    usersStore.set(studentBId.toString(), {
      _id: studentBId,
      email: 'student_b@example.com',
      role: 'student',
      session_version: 1,
    })
    usersStore.set(adminId.toString(), {
      _id: adminId,
      email: 'admin@example.com',
      role: 'admin',
      session_version: 1,
    })

    // Seed internship with 2 tasks: task 1 (7 days), task 2 (7 days)
    internshipsStore.set(internshipId.toString(), {
      _id: internshipId,
      title: 'Backend Engineering',
      tasks: [
        {
          task_number: 1,
          title: 'Database Schema Design',
          description: 'Design robust schemas',
          deadline_days: 7,
        },
        {
          task_number: 2,
          title: 'REST API Implementation',
          description: 'Implement API routes',
          deadline_days: 7,
        },
      ],
    })

    // Mock User.findById
    jest.spyOn(User, 'findById').mockImplementation((id: unknown) => {
      const u = usersStore.get(String(id))
      return Promise.resolve(u as unknown as IUser)
    })

    // Mock Internship.findById
    jest.spyOn(Internship, 'findById').mockImplementation((id: unknown) => {
      const i = internshipsStore.get(String(id))
      return Promise.resolve(i as unknown as IInternship)
    })

    // Mock Enrollment.findOne
    jest.spyOn(Enrollment, 'findOne').mockImplementation((query: unknown) => {
      const q = query as Record<string, unknown>
      for (const e of enrollmentsStore.values()) {
        const matchId = !q._id || String(e._id) === String(q._id)
        const matchUser = !q.user_id || String(e.user_id) === String(q.user_id)
        if (matchId && matchUser) {
          return Promise.resolve(e as unknown as IEnrollment)
        }
      }
      return Promise.resolve(null)
    })

    // Mock Enrollment.findById
    jest.spyOn(Enrollment, 'findById').mockImplementation((id: unknown) => {
      const e = enrollmentsStore.get(String(id))
      return Promise.resolve(e as unknown as IEnrollment)
    })

    // Mock Enrollment.findByIdAndUpdate
    jest
      .spyOn(Enrollment, 'findByIdAndUpdate')
      .mockImplementation((id: unknown, update: unknown) => {
        const e = enrollmentsStore.get(String(id))
        if (!e) return Promise.resolve(null)
        const u = update as {
          $inc?: { current_task?: number }
          completed_at?: Date
        }
        if (u.$inc?.current_task) {
          e.current_task += u.$inc.current_task
        }
        if (u.completed_at) {
          e.completed_at = u.completed_at
        }
        enrollmentsStore.set(String(id), e)
        return Promise.resolve(e as unknown as IEnrollment)
      })

    // Mock Enrollment.updateMany for expiration worker
    jest
      .spyOn(Enrollment, 'updateMany')
      .mockImplementation((query: unknown, update: unknown) => {
        const q = query as { status: string; end_date: { $lt: Date } }
        const u = update as { $set: { status: 'expired' } }
        let count = 0
        for (const e of enrollmentsStore.values()) {
          if (e.status === q.status && e.end_date < q.end_date.$lt) {
            e.status = u.$set.status
            count++
          }
        }
        return Promise.resolve({
          matchedCount: count,
          modifiedCount: count,
          acknowledged: true,
          upsertedId: null,
          upsertedCount: 0,
        }) as unknown as ReturnType<typeof Enrollment.updateMany>
      })

    // Mock TaskSubmission.findOne
    jest
      .spyOn(TaskSubmission, 'findOne')
      .mockImplementation((query: unknown) => {
        const q = query as Record<string, unknown>
        for (const s of submissionsStore.values()) {
          const matchEnroll =
            !q.enrollment_id ||
            String(s.enrollment_id) === String(q.enrollment_id)
          const matchTaskNum =
            q.task_number === undefined || s.task_number === q.task_number
          const matchStatus = !q.status || s.status === q.status
          if (matchEnroll && matchTaskNum && matchStatus) {
            return Promise.resolve(s as unknown as ITaskSubmission)
          }
        }
        return Promise.resolve(null)
      })

    // Mock TaskSubmission.findById
    jest.spyOn(TaskSubmission, 'findById').mockImplementation((id: unknown) => {
      const s = submissionsStore.get(String(id))
      return Promise.resolve(s as unknown as ITaskSubmission)
    })

    // Mock TaskSubmission.create
    jest.spyOn(TaskSubmission, 'create').mockImplementation((data: unknown) => {
      const id = new mongoose.Types.ObjectId()
      const item = data as Record<string, unknown>
      const s: MockSubmission = {
        _id: id,
        enrollment_id: item.enrollment_id as mongoose.Types.ObjectId,
        task_number: item.task_number as number,
        status: item.status as 'pending',
        content: item.content as string,
        submitted_at: (item.submitted_at as Date) || new Date(),
      }
      submissionsStore.set(id.toString(), s)
      return Promise.resolve(s as unknown as ITaskSubmission)
    })

    // Mock TaskSubmission.findOneAndUpdate (atomic check for SEC-12)
    jest
      .spyOn(TaskSubmission, 'findOneAndUpdate')
      .mockImplementation((query: unknown, update: unknown) => {
        const q = query as {
          _id: unknown
          status: string
          task_number: number
        }
        const s = submissionsStore.get(String(q._id))
        if (!s) return Promise.resolve(null)
        if (s.status !== q.status || s.task_number !== q.task_number) {
          return Promise.resolve(null)
        }
        const u = update as {
          status: 'approved' | 'rejected'
          reviewed_by: mongoose.Types.ObjectId
          reviewed_at: Date
          feedback: string | null
        }
        s.status = u.status
        s.reviewed_by = u.reviewed_by
        s.reviewed_at = u.reviewed_at
        s.feedback = u.feedback
        submissionsStore.set(String(q._id), s)
        return Promise.resolve(s as unknown as ITaskSubmission)
      })

    // Mock TaskSubmission.find
    jest.spyOn(TaskSubmission, 'find').mockImplementation((query: unknown) => {
      const q = query as Record<string, unknown>
      const results: MockSubmission[] = []
      for (const s of submissionsStore.values()) {
        const matchEnroll =
          !q.enrollment_id ||
          String(s.enrollment_id) === String(q.enrollment_id)
        const matchStatus = !q.status || s.status === q.status
        if (matchEnroll && matchStatus) {
          results.push(s)
        }
      }
      const queryObj = {
        sort: () => queryObj,
        limit: () => queryObj,
        populate: () => Promise.resolve(results),
        then: (resolve: (val: MockSubmission[]) => void) => resolve(results),
      }
      return queryObj as unknown as mongoose.Query<
        ITaskSubmission[],
        ITaskSubmission
      >
    })

    // Mock AuditLog.create
    jest.spyOn(AuditLog, 'create').mockImplementation((data: unknown) => {
      const id = new mongoose.Types.ObjectId()
      const item = data as MockAuditLog
      const log = { _id: id, ...item }
      auditLogsStore.set(id.toString(), log)
      return Promise.resolve(log as unknown as IAuditLog)
    })
  })

  describe('POST /tasks/submit', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/tasks/submit')
        .send({ enrollment_id: 'some_id', content: 'Sample code' })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('unauthorized')
    })

    it('rejects requests missing CSRF token with 403', async () => {
      const res = await request(app)
        .post('/tasks/submit')
        .set('Cookie', getAuthCookie(studentAId))
        .send({ enrollment_id: 'some_id', content: 'Sample code submission' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('invalid_csrf_token')
    })

    it('rejects if enrollment does not belong to user with 404', async () => {
      const enrollmentId = new mongoose.Types.ObjectId()
      enrollmentsStore.set(enrollmentId.toString(), {
        _id: enrollmentId,
        user_id: studentBId, // Belongs to Student B
        internship_id: internshipId,
        status: 'active',
        current_task: 1,
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      const res = await request(app)
        .post('/tasks/submit')
        .set('Cookie', [getAuthCookie(studentAId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({
          enrollment_id: enrollmentId.toString(),
          content: 'My completed task 1 code submission',
        })

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('enrollment_not_found')
    })

    it('rejects if enrollment is expired or not active with 400', async () => {
      const enrollmentId = new mongoose.Types.ObjectId()
      enrollmentsStore.set(enrollmentId.toString(), {
        _id: enrollmentId,
        user_id: studentAId,
        internship_id: internshipId,
        status: 'expired',
        current_task: 1,
        start_date: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        end_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      })

      const res = await request(app)
        .post('/tasks/submit')
        .set('Cookie', [getAuthCookie(studentAId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({
          enrollment_id: enrollmentId.toString(),
          content: 'Late submission for task 1',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('enrollment_not_active')
    })

    it('rejects if now > enrollment.end_date with 400 (enrollment_expired)', async () => {
      const enrollmentId = new mongoose.Types.ObjectId()
      // Active in status but past end_date
      enrollmentsStore.set(enrollmentId.toString(), {
        _id: enrollmentId,
        user_id: studentAId,
        internship_id: internshipId,
        status: 'active',
        current_task: 1,
        start_date: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
        end_date: new Date(Date.now() - 1000), // Ended 1 second ago
      })

      const res = await request(app)
        .post('/tasks/submit')
        .set('Cookie', [getAuthCookie(studentAId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({
          enrollment_id: enrollmentId.toString(),
          content: 'Past end date submission',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('enrollment_expired')
    })

    it('rejects if task deadline has passed with 400 (task_deadline_passed)', async () => {
      const enrollmentId = new mongoose.Types.ObjectId()
      // Started 10 days ago. Task 1 has 7 days deadline. Current task is 1.
      enrollmentsStore.set(enrollmentId.toString(), {
        _id: enrollmentId,
        user_id: studentAId,
        internship_id: internshipId,
        status: 'active',
        current_task: 1,
        start_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        end_date: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      })

      const res = await request(app)
        .post('/tasks/submit')
        .set('Cookie', [getAuthCookie(studentAId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({
          enrollment_id: enrollmentId.toString(),
          content: 'Submission after task deadline',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('task_deadline_passed')
    })

    it('creates submission with status pending when valid', async () => {
      const enrollmentId = new mongoose.Types.ObjectId()
      enrollmentsStore.set(enrollmentId.toString(), {
        _id: enrollmentId,
        user_id: studentAId,
        internship_id: internshipId,
        status: 'active',
        current_task: 1,
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      const res = await request(app)
        .post('/tasks/submit')
        .set('Cookie', [getAuthCookie(studentAId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({
          enrollment_id: enrollmentId.toString(),
          content: 'Here is my complete solution with tests and schemas',
        })

      expect(res.status).toBe(201)
      expect(res.body.status).toBe('success')
      expect(res.body.submission.task_number).toBe(1)
      expect(res.body.submission.status).toBe('pending')
      expect(submissionsStore.size).toBe(1)
    })

    it('rejects duplicate pending submission for current task with 409', async () => {
      const enrollmentId = new mongoose.Types.ObjectId()
      enrollmentsStore.set(enrollmentId.toString(), {
        _id: enrollmentId,
        user_id: studentAId,
        internship_id: internshipId,
        status: 'active',
        current_task: 1,
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      // Existing pending submission
      const subId = new mongoose.Types.ObjectId()
      submissionsStore.set(subId.toString(), {
        _id: subId,
        enrollment_id: enrollmentId,
        task_number: 1,
        status: 'pending',
        content: 'First pending submission',
        submitted_at: new Date(),
      })

      const res = await request(app)
        .post('/tasks/submit')
        .set('Cookie', [getAuthCookie(studentAId), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({
          enrollment_id: enrollmentId.toString(),
          content: 'Second attempt while first is pending',
        })

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('submission_already_pending')
    })
  })

  describe('GET /tasks/enrollment/:enrollment_id', () => {
    it('returns submissions list for student enrollment', async () => {
      const enrollmentId = new mongoose.Types.ObjectId()
      enrollmentsStore.set(enrollmentId.toString(), {
        _id: enrollmentId,
        user_id: studentAId,
        internship_id: internshipId,
        status: 'active',
        current_task: 2,
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      const sub1Id = new mongoose.Types.ObjectId()
      submissionsStore.set(sub1Id.toString(), {
        _id: sub1Id,
        enrollment_id: enrollmentId,
        task_number: 1,
        status: 'approved',
        content: 'Task 1 code',
        submitted_at: new Date(),
      })

      const res = await request(app)
        .get(`/tasks/enrollment/${enrollmentId}`)
        .set('Cookie', getAuthCookie(studentAId))

      expect(res.status).toBe(200)
      expect(res.body.submissions).toHaveLength(1)
      expect(res.body.submissions[0].task_number).toBe(1)
    })
  })

  describe('Admin Review & SEC-12 Security Gate', () => {
    it('rejects review by non-admin with 403 forbidden', async () => {
      const subId = new mongoose.Types.ObjectId()
      const res = await request(app)
        .post(`/admin/submissions/${subId}/review`)
        .set('Cookie', [getAuthCookie(studentAId, 'student'), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({ decision: 'approved' })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('forbidden')
    })

    it('approves pending task and increments enrollment.current_task', async () => {
      const enrollmentId = new mongoose.Types.ObjectId()
      enrollmentsStore.set(enrollmentId.toString(), {
        _id: enrollmentId,
        user_id: studentAId,
        internship_id: internshipId,
        status: 'active',
        current_task: 1,
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      const subId = new mongoose.Types.ObjectId()
      submissionsStore.set(subId.toString(), {
        _id: subId,
        enrollment_id: enrollmentId,
        task_number: 1,
        status: 'pending',
        content: 'Task 1 solution',
        submitted_at: new Date(),
      })

      const res = await request(app)
        .post(`/admin/submissions/${subId}/review`)
        .set('Cookie', [getAuthCookie(adminId, 'admin'), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({ decision: 'approved', feedback: 'Great job!' })

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('success')
      expect(res.body.decision).toBe('approved')
      expect(res.body.next_task).toBe(2)

      // Invariant: current_task incremented to 2
      const updatedEnrollment = enrollmentsStore.get(enrollmentId.toString())
      expect(updatedEnrollment?.current_task).toBe(2)

      // Invariant: AuditLog entry created
      expect(auditLogsStore.size).toBe(1)
      const auditLog = Array.from(auditLogsStore.values())[0]
      expect(auditLog.action).toBe('REVIEW_SUBMISSION')
      expect(auditLog.target_id).toBe(subId.toString())
    })

    it('marks completed_at when final task in internship is approved', async () => {
      const enrollmentId = new mongoose.Types.ObjectId()
      enrollmentsStore.set(enrollmentId.toString(), {
        _id: enrollmentId,
        user_id: studentAId,
        internship_id: internshipId,
        status: 'active',
        current_task: 2, // Internship has 2 tasks total
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      const subId = new mongoose.Types.ObjectId()
      submissionsStore.set(subId.toString(), {
        _id: subId,
        enrollment_id: enrollmentId,
        task_number: 2,
        status: 'pending',
        content: 'Task 2 solution',
        submitted_at: new Date(),
      })

      const res = await request(app)
        .post(`/admin/submissions/${subId}/review`)
        .set('Cookie', [getAuthCookie(adminId, 'admin'), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({ decision: 'approved' })

      expect(res.status).toBe(200)
      expect(res.body.next_task).toBe(3)
      const updatedEnrollment = enrollmentsStore.get(enrollmentId.toString())
      expect(updatedEnrollment?.completed_at).toBeDefined()
    })

    it('SEC-12: rejects stale review when submission already reviewed or task mismatch (409 Conflict)', async () => {
      const enrollmentId = new mongoose.Types.ObjectId()
      enrollmentsStore.set(enrollmentId.toString(), {
        _id: enrollmentId,
        user_id: studentAId,
        internship_id: internshipId,
        status: 'active',
        current_task: 2, // Enrollment is already at task 2
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      // Stale task 1 submission that was already approved earlier
      const subId = new mongoose.Types.ObjectId()
      submissionsStore.set(subId.toString(), {
        _id: subId,
        enrollment_id: enrollmentId,
        task_number: 1, // Task 1, but enrollment current_task is 2
        status: 'approved',
        content: 'Old task 1 solution',
        submitted_at: new Date(),
      })

      // Attempt to review stale task 1 submission
      const res = await request(app)
        .post(`/admin/submissions/${subId}/review`)
        .set('Cookie', [getAuthCookie(adminId, 'admin'), csrfCookie])
        .set('x-csrf-token', csrfToken)
        .send({ decision: 'approved' })

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('stale_review')

      // Crucial SEC-12 invariant: current_task must NOT be incremented
      const enrollment = enrollmentsStore.get(enrollmentId.toString())
      expect(enrollment?.current_task).toBe(2)
    })
  })

  describe('Enrollment Expiration Worker', () => {
    it('flips past-due active enrollments to expired', async () => {
      const activeValidId = new mongoose.Types.ObjectId()
      const activePastDueId = new mongoose.Types.ObjectId()
      const now = new Date()

      enrollmentsStore.set(activeValidId.toString(), {
        _id: activeValidId,
        user_id: studentAId,
        internship_id: internshipId,
        status: 'active',
        current_task: 1,
        start_date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        end_date: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000), // In future
      })

      enrollmentsStore.set(activePastDueId.toString(), {
        _id: activePastDueId,
        user_id: studentBId,
        internship_id: internshipId,
        status: 'active',
        current_task: 1,
        start_date: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
        end_date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // In past
      })

      const { expiredCount } = await expirePastDueEnrollments()

      expect(expiredCount).toBe(1)
      expect(enrollmentsStore.get(activeValidId.toString())?.status).toBe(
        'active',
      )
      expect(enrollmentsStore.get(activePastDueId.toString())?.status).toBe(
        'expired',
      )
    })
  })
})
