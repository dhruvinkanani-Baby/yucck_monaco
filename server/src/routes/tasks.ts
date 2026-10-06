import { Router } from 'express'
import {
  submitTask,
  getEnrollmentSubmissions,
} from '../controllers/taskController.js'
import { authenticate } from '../middleware/auth.js'
import { csrfProtection } from '../middleware/csrf.js'

export const taskRouter = Router()

taskRouter.post('/submit', authenticate, csrfProtection, submitTask)
taskRouter.get(
  '/enrollment/:enrollment_id',
  authenticate,
  getEnrollmentSubmissions,
)
