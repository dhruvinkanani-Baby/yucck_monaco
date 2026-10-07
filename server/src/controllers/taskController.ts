import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { Enrollment } from '../models/Enrollment.js'
import { Internship } from '../models/Internship.js'
import { TaskSubmission } from '../models/TaskSubmission.js'
import { validateSafeUrl } from '../utils/sanitize.js'

const submitTaskSchema = z.object({
  enrollment_id: z.string().min(1),
  content: z.string().trim().min(5).max(10000),
  submission_url: z.string().trim().optional(),
})

export async function submitTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parseResult = submitTaskSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'validation_error',
        details: parseResult.error.format(),
      })
      return
    }

    const { enrollment_id, content, submission_url } = parseResult.data

    // SEC-07: Reject unsafe submission URLs (e.g., javascript:...linkedin.com)
    if (submission_url) {
      const urlCheck = validateSafeUrl(submission_url)
      if (!urlCheck.valid) {
        res.status(400).json({
          error: 'invalid_submission_url',
          message: urlCheck.error,
        })
        return
      }
    }

    // SEC-07: Reject embedded pseudo-protocol script injections in content
    const contentWithoutWs = content.replace(/\s+/g, '').toLowerCase()
    if (
      contentWithoutWs.includes('javascript:') ||
      contentWithoutWs.includes('vbscript:') ||
      contentWithoutWs.includes('data:text/html')
    ) {
      res.status(400).json({
        error: 'unsafe_script_scheme',
        message:
          'Submissions containing unsafe script or pseudo-protocol URIs are prohibited.',
      })
      return
    }
    const userId = req.user?._id

    if (!userId) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    const enrollment = await Enrollment.findOne({
      _id: enrollment_id,
      user_id: userId,
    })

    if (!enrollment) {
      res.status(404).json({
        error: 'enrollment_not_found',
        message: 'Enrollment not found or does not belong to you.',
      })
      return
    }

    if (enrollment.status !== 'active') {
      res.status(400).json({
        error: 'enrollment_not_active',
        message: `Enrollment is currently ${enrollment.status}.`,
      })
      return
    }

    const now = new Date()

    // Invariant 1: Reject if (now > enrollment.end_date)
    if (now > enrollment.end_date) {
      res.status(400).json({
        error: 'enrollment_expired',
        message: 'Enrollment deadline has passed.',
      })
      return
    }

    // Lookup internship to check task definition and task-specific deadline
    const internship = await Internship.findById(enrollment.internship_id)
    if (!internship) {
      res.status(404).json({ error: 'internship_not_found' })
      return
    }

    const currentTaskNumber = enrollment.current_task
    const taskDefinition = internship.tasks.find(
      (t) => t.task_number === currentTaskNumber,
    )

    if (!taskDefinition) {
      res.status(400).json({
        error: 'all_tasks_completed',
        message: 'All tasks for this internship have already been completed.',
      })
      return
    }

    // Invariant 2: Calculate task due_at from task deadline days (cumulative or per-task window)
    const cumulativeDays = internship.tasks
      .filter((t) => t.task_number <= currentTaskNumber)
      .reduce((sum, t) => sum + t.deadline_days, 0)

    const taskDueAt = new Date(
      enrollment.start_date.getTime() + cumulativeDays * 24 * 60 * 60 * 1000,
    )

    if (now > taskDueAt) {
      res.status(400).json({
        error: 'task_deadline_passed',
        message: `Task #${currentTaskNumber} deadline passed on ${taskDueAt.toISOString()}.`,
      })
      return
    }

    // Check if submission already pending for current task
    const existingPending = await TaskSubmission.findOne({
      enrollment_id: enrollment._id,
      task_number: currentTaskNumber,
      status: 'pending',
    })

    if (existingPending) {
      res.status(409).json({
        error: 'submission_already_pending',
        message: 'A submission for this task is already awaiting review.',
      })
      return
    }

    // Create TaskSubmission { status: "pending" }
    const savedContent = submission_url
      ? `${content}\n\nSubmission Link: ${submission_url}`
      : content

    const submission = await TaskSubmission.create({
      enrollment_id: enrollment._id,
      task_number: currentTaskNumber,
      status: 'pending',
      content: savedContent,
      submitted_at: now,
    })

    res.status(201).json({
      status: 'success',
      submission: {
        id: String(submission._id),
        enrollment_id: String(submission.enrollment_id),
        task_number: submission.task_number,
        status: submission.status,
        content: submission.content,
        submitted_at: submission.submitted_at.toISOString(),
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function getEnrollmentSubmissions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { enrollment_id } = req.params
    const userId = req.user?._id

    const enrollment = await Enrollment.findOne({
      _id: enrollment_id,
      user_id: userId,
    })

    if (!enrollment) {
      res.status(404).json({ error: 'enrollment_not_found' })
      return
    }

    const submissions = await TaskSubmission.find({
      enrollment_id: enrollment._id,
    }).sort({ task_number: 1, submitted_at: -1 })

    res.status(200).json({
      submissions: submissions.map((s) => ({
        id: String(s._id),
        task_number: s.task_number,
        status: s.status,
        content: s.content,
        feedback: s.feedback,
        submitted_at: s.submitted_at.toISOString(),
        reviewed_at: s.reviewed_at?.toISOString() || null,
      })),
    })
  } catch (err) {
    next(err)
  }
}
