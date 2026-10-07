import { Router } from 'express'
import {
  getPublicInternships,
  getPlatformMetrics,
  getInternshipById,
} from '../controllers/internshipController.js'
import { validateObjectId } from '../middleware/validateObjectId.js'

export const internshipRouter = Router()

internshipRouter.get('/', getPublicInternships)
internshipRouter.get('/metrics', getPlatformMetrics)
internshipRouter.get('/:id', validateObjectId('id'), getInternshipById)
