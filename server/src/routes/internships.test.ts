import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import { app } from '../app.js'
import { User, type IUser } from '../models/User.js'
import { Internship } from '../models/Internship.js'
import { Enrollment } from '../models/Enrollment.js'
import { Certificate } from '../models/Certificate.js'
import { signSessionToken } from '../middleware/auth.js'

describe('Step 9 — Public Catalog & Student Dashboard Endpoints', () => {
  interface MockUser {
    _id: mongoose.Types.ObjectId
    email: string
    role: 'student' | 'admin'
    session_version: number
  }

  interface MockInternship {
    _id: mongoose.Types.ObjectId
    title: string
    description: string
    price: number
    currency: string
    is_active: boolean
    tasks: Array<{
      task_number: number
      title: string
      description: string
      deadline_days: number
    }>
    createdAt: Date
    updatedAt: Date
  }

  interface MockEnrollment {
    _id: mongoose.Types.ObjectId
    user_id: mongoose.Types.ObjectId
    internship_id: mongoose.Types.ObjectId
    status: 'active' | 'expired' | 'closed'
    current_task: number
    start_date: Date
    end_date: Date
    completed_at?: Date | null
    createdAt: Date
    updatedAt: Date
  }

  interface MockCertificate {
    _id: mongoose.Types.ObjectId
    enrollment_id: mongoose.Types.ObjectId
    verification_code: string
    pdf_url: string
    issued_at: Date
    status: 'valid' | 'revoked'
  }

  const usersStore = new Map<string, MockUser>()
  const internshipsStore = new Map<string, MockInternship>()
  const enrollmentsStore = new Map<string, MockEnrollment>()
  const certificatesStore = new Map<string, MockCertificate>()

  const studentId = new mongoose.Types.ObjectId()
  const trackId = new mongoose.Types.ObjectId()
  const enrollmentId = new mongoose.Types.ObjectId()
  const certId = new mongoose.Types.ObjectId()

  beforeEach(() => {
    usersStore.clear()
    internshipsStore.clear()
    enrollmentsStore.clear()
    certificatesStore.clear()

    usersStore.set(studentId.toHexString(), {
      _id: studentId,
      email: 'student@example.com',
      role: 'student',
      session_version: 1,
    })

    internshipsStore.set(trackId.toHexString(), {
      _id: trackId,
      title: 'Full Stack Engineering',
      description: 'Production web application architecture with React & Node',
      price: 4999,
      currency: 'INR',
      is_active: true,
      tasks: [
        {
          task_number: 1,
          title: 'Database Design',
          description: 'Design schema',
          deadline_days: 7,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    enrollmentsStore.set(enrollmentId.toHexString(), {
      _id: enrollmentId,
      user_id: studentId,
      internship_id: trackId,
      status: 'active',
      current_task: 1,
      start_date: new Date(),
      end_date: new Date(Date.now() + 30 * 86400000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    certificatesStore.set(certId.toHexString(), {
      _id: certId,
      enrollment_id: enrollmentId,
      verification_code: '44444444-5555-6666-7777-888888888888',
      pdf_url: 'https://cdn.example.com/cert.pdf',
      issued_at: new Date(),
      status: 'valid',
    })

    jest.spyOn(User, 'findById').mockImplementation(((id: unknown) => {
      const u = usersStore.get(String(id))
      return Promise.resolve(u as unknown as IUser)
    }) as unknown as typeof User.findById)

    jest.spyOn(Internship.prototype, 'save').mockImplementation(function (
      this: unknown,
    ) {
      return Promise.resolve(this)
    } as unknown as typeof Internship.prototype.save)

    jest.spyOn(Internship, 'find').mockImplementation(((filter: unknown) => {
      const all = Array.from(internshipsStore.values())
      const isAct = (filter as { is_active?: boolean })?.is_active
      const filtered =
        isAct !== undefined ? all.filter((i) => i.is_active === isAct) : all

      const queryObj: {
        sort: () => typeof queryObj
        skip: () => typeof queryObj
        limit: () => typeof queryObj
        then: (resolve: (v: unknown) => unknown) => Promise<unknown>
      } = {
        sort: () => queryObj,
        skip: () => queryObj,
        limit: () => queryObj,
        then: (resolve) => Promise.resolve(filtered).then(resolve),
      }

      return queryObj as unknown as ReturnType<typeof Internship.find>
    }) as unknown as typeof Internship.find)

    jest.spyOn(Internship, 'countDocuments').mockImplementation(() => {
      return Promise.resolve(internshipsStore.size) as unknown as ReturnType<
        typeof Internship.countDocuments
      >
    })

    jest.spyOn(Enrollment, 'countDocuments').mockImplementation(((
      filter: unknown,
    ) => {
      const status = (filter as { status?: string })?.status
      if (status === 'active') {
        return Promise.resolve(142) as unknown as ReturnType<
          typeof Enrollment.countDocuments
        >
      }
      return Promise.resolve(160) as unknown as ReturnType<
        typeof Enrollment.countDocuments
      >
    }) as unknown as typeof Enrollment.countDocuments)

    jest.spyOn(Certificate, 'countDocuments').mockImplementation(() => {
      return Promise.resolve(388) as unknown as ReturnType<
        typeof Certificate.countDocuments
      >
    })

    jest.spyOn(Internship, 'findById').mockImplementation(((id: unknown) => {
      const track = internshipsStore.get(String(id))
      return Promise.resolve(track || null) as unknown as ReturnType<
        typeof Internship.findById
      >
    }) as unknown as typeof Internship.findById)

    jest.spyOn(Enrollment, 'find').mockImplementation(((filter: unknown) => {
      const uid = (filter as { user_id?: mongoose.Types.ObjectId })?.user_id
      const matches = Array.from(enrollmentsStore.values())
        .filter((e) => String(e.user_id) === String(uid))
        .map((e) => ({
          ...e,
          internship_id: internshipsStore.get(String(e.internship_id)),
        }))

      const queryObj: {
        sort: () => typeof queryObj
        populate: () => typeof queryObj
        then: (resolve: (v: unknown) => unknown) => Promise<unknown>
      } = {
        sort: () => queryObj,
        populate: () => queryObj,
        then: (resolve) => Promise.resolve(matches).then(resolve),
      }

      return queryObj as unknown as ReturnType<typeof Enrollment.find>
    }) as unknown as typeof Enrollment.find)

    jest.spyOn(Certificate, 'find').mockImplementation(((filter: unknown) => {
      const enrollmentIds = (
        filter as { enrollment_id?: { $in: mongoose.Types.ObjectId[] } }
      )?.enrollment_id?.$in

      const matches = Array.from(certificatesStore.values()).filter(
        (c) =>
          enrollmentIds?.some(
            (eid) => String(eid) === String(c.enrollment_id),
          ) && c.status === 'valid',
      )

      return Promise.resolve(matches) as unknown as ReturnType<
        typeof Certificate.find
      >
    }) as unknown as typeof Certificate.find)
  })

  it('GET /internships returns paginated track list', async () => {
    const res = await request(app).get('/internships?page=1&limit=10')

    expect(res.status).toBe(200)
    expect(res.body.internships).toHaveLength(1)
    expect(res.body.internships[0].title).toBe('Full Stack Engineering')
    expect(res.body.total).toBe(1)
  })

  it('GET /internships/metrics aggregates live platform numbers', async () => {
    const res = await request(app).get('/internships/metrics')

    expect(res.status).toBe(200)
    expect(res.body.active_students).toBe(142)
    expect(res.body.verified_certificates).toBe(388)
    expect(res.body.industry_programs).toBe(1)
    expect(typeof res.body.completion_rate).toBe('number')
  })

  it('GET /internships/:id returns track detail or 404', async () => {
    const foundRes = await request(app).get(`/internships/${trackId}`)
    expect(foundRes.status).toBe(200)
    expect(foundRes.body.internship.id).toBe(trackId.toHexString())

    const randomId = new mongoose.Types.ObjectId()
    const notFoundRes = await request(app).get(`/internships/${randomId}`)
    expect(notFoundRes.status).toBe(404)
    expect(notFoundRes.body.error).toBe('internship_not_found')
  })

  it('GET /enroll/my rejects unauthenticated students with 401', async () => {
    const res = await request(app).get('/enroll/my')
    expect(res.status).toBe(401)
  })

  it('GET /enroll/my returns populated enrolled programs for student', async () => {
    const token = signSessionToken(
      {
        _id: studentId,
        role: 'student',
        session_version: 1,
      },
      'student',
    )

    const res = await request(app)
      .get('/enroll/my')
      .set('Cookie', [`session=${token}`])

    expect(res.status).toBe(200)
    expect(res.body.enrollments).toHaveLength(1)
    expect(res.body.enrollments[0].internship.title).toBe(
      'Full Stack Engineering',
    )
    expect(res.body.enrollments[0].certificate.verification_code).toBe(
      '44444444-5555-6666-7777-888888888888',
    )
  })
})
