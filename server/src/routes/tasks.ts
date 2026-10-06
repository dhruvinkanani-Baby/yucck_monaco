import { Router } from 'express'
import {
  submitTask,
  getEnrollmentSubmissions,
} from '../controllers/taskController.js'
import { authenticate } from '../middleware/auth.js'
import { csrfProtection } from '../middleware/csrf.js'
import { validateObjectId } from '../middleware/validateObjectId.js'

export const taskRouter = Router()

taskRouter.post('/submit', authenticate, csrfProtection, submitTask)
taskRouter.get(
  '/enrollment/:enrollment_id',
  authenticate,
  validateObjectId('enrollment_id'),
  getEnrollmentSubmissions,
)
