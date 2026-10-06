import { Router } from 'express'
import {
  getPublicInternships,
  getPlatformMetrics,
  getInternshipById,
} from '../controllers/internshipController.js'

export const internshipRouter = Router()

internshipRouter.get('/', getPublicInternships)
internshipRouter.get('/metrics', getPlatformMetrics)
internshipRouter.get('/:id', getInternshipById)
