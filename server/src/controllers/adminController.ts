import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { TaskSubmission } from '../models/TaskSubmission.js'
import { Enrollment } from '../models/Enrollment.js'
import { Internship } from '../models/Internship.js'
import { AuditLog } from '../models/AuditLog.js'
import { enqueueCertificateIssuance } from '../workers/certificateWorker.js'

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  feedback: z.string().trim().max(2000).optional(),
})

export async function reviewSubmission(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params
    const parseResult = reviewSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { decision, feedback } = parseResult.data
    const adminId = req.user?._id

    if (!adminId) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    // Step 1: Initial submission lookup to resolve parent enrollment
    const existingSub = await TaskSubmission.findById(id)
    if (!existingSub) {
      res.status(404).json({ error: 'submission_not_found' })
      return
    }

    const enrollment = await Enrollment.findById(existingSub.enrollment_id)
    if (!enrollment) {
      res.status(404).json({ error: 'enrollment_not_found' })
      return
    }

    // Step 2: Atomic findOneAndUpdate with status "pending" and task_number === enrollment.current_task
    // Invariant SEC-12: Approving stale/old task twice or after concurrent change yields 409
    const sub = await TaskSubmission.findOneAndUpdate(
      {
        _id: id,
        status: 'pending',
        task_number: enrollment.current_task,
      },
      {
        status: decision,
        reviewed_by: adminId,
        reviewed_at: new Date(),
        feedback: feedback || null,
      },
      { new: true },
    )

    if (!sub) {
      res.status(409).json({
        error: 'stale_review',
        message:
          'This submission is no longer pending or does not match the active task.',
      })
      return
    }

    // Step 3: On approval, increment enrollment.current_task (never decrement/overwrite)
    let nextTaskNumber = enrollment.current_task
    if (decision === 'approved') {
      nextTaskNumber = enrollment.current_task + 1
      await Enrollment.findByIdAndUpdate(
        enrollment._id,
        { $inc: { current_task: 1 } },
        { new: true },
      )

      // Check if all tasks in internship have been finished
      const internship = await Internship.findById(enrollment.internship_id)
      const totalTasks = internship?.tasks.length || 0

      if (totalTasks > 0 && nextTaskNumber > totalTasks) {
        await Enrollment.findByIdAndUpdate(enrollment._id, {
          completed_at: new Date(),
        })
        try {
          await enqueueCertificateIssuance(String(enrollment._id))
        } catch {
          // Worker/Redis enqueue failure does not block review response
        }
      }
    }

    // Step 4: Write AuditLog entry (append-only)
    const reqId =
      (req.id as string) || (res.getHeader('x-request-id') as string) || null

    await AuditLog.create({
      admin_id: adminId,
      action: 'REVIEW_SUBMISSION',
      target_type: 'TaskSubmission',
      target_id: String(sub._id),
      before: {
        status: 'pending',
        current_task: enrollment.current_task,
      },
      after: {
        status: decision,
        current_task: nextTaskNumber,
        feedback: feedback || null,
      },
      ip: req.ip || null,
      request_id: reqId,
    })

    res.status(200).json({
      status: 'success',
      decision,
      submission: {
        id: String(sub._id),
        status: sub.status,
        task_number: sub.task_number,
        reviewed_at: sub.reviewed_at?.toISOString(),
        feedback: sub.feedback,
      },
      next_task: nextTaskNumber,
    })
  } catch (err) {
    next(err)
  }
}

export async function getPendingSubmissions(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const pendingList = await TaskSubmission.find({ status: 'pending' })
      .sort({ submitted_at: 1 })
      .limit(100)
      .populate('enrollment_id')

    res.status(200).json({
      submissions: pendingList.map((s) => ({
        id: String(s._id),
        enrollment_id: String(s.enrollment_id),
        task_number: s.task_number,
        status: s.status,
        content: s.content,
        submitted_at: s.submitted_at.toISOString(),
      })),
    })
  } catch (err) {
    next(err)
  }
}

export async function issueCertificateForEnrollment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params
    const enrollment = await Enrollment.findById(id)
    if (!enrollment) {
      res.status(404).json({ error: 'enrollment_not_found' })
      return
    }

    if (!enrollment.completed_at) {
      res.status(400).json({
        error: 'enrollment_not_completed',
        message:
          'Cannot issue certificate before all milestones are completed.',
      })
      return
    }

    await enqueueCertificateIssuance(String(enrollment._id))

    res.status(202).json({
      status: 'queued',
      message: 'Certificate issuance job enqueued successfully.',
      enrollment_id: String(enrollment._id),
    })
  } catch (err) {
    next(err)
  }
}
