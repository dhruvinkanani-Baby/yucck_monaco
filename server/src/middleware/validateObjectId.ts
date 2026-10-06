import type { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'

/**
 * Express middleware that validates that a route parameter conforms to
 * a valid 24-character hexadecimal MongoDB ObjectId.
 * Prevents CastErrors and rejects malformed inputs with a structured 400 response.
 */
export function validateObjectId(paramName = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawParam = req.params[paramName]
    const paramVal = Array.isArray(rawParam) ? rawParam[0] : rawParam

    if (!paramVal || !mongoose.isValidObjectId(paramVal)) {
      res.status(400).json({
        error: 'invalid_id_format',
        message: `Route parameter '${paramName}' must be a valid 24-character hex ObjectId.`,
      })
      return
    }

    next()
  }
}
