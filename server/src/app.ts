import { env } from './config/env.js'
import crypto from 'node:crypto'
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { pinoHttp } from 'pino-http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { logger } from './config/logger.js'
import { authRouter } from './routes/auth.js'
import { enrollRouter } from './routes/enroll.js'
import { webhookRouter } from './routes/webhooks.js'
import { taskRouter } from './routes/tasks.js'
import { adminRouter } from './routes/admin.js'
import { verifyRouter } from './routes/verify.js'
import { internshipRouter } from './routes/internships.js'

export const app = express()

// app.set("trust proxy", <explicit config per environment>) — not a bare 1
app.set(
  'trust proxy',
  env.NODE_ENV === 'production'
    ? ['loopback', 'linklocal', 'uniquelocal']
    : false,
)

// Security headers
app.use(helmet())

// Strict CORS with credentials
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
)

// Request logger with request-id propagation
app.use(
  pinoHttp<IncomingMessage, ServerResponse>({
    logger,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const existing = req.headers['x-request-id']
      const id =
        (typeof existing === 'string' && existing) || crypto.randomUUID()
      res.setHeader('x-request-id', id)
      return id
    },
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },
  }),
)

// Cookie parser with signed cookie support
app.use(cookieParser(env.COOKIE_SECRET))

// Mount webhooks route with raw body parser BEFORE global express.json()
app.use(
  '/webhooks',
  express.raw({ type: '*/*', limit: '100kb' }),
  webhookRouter,
)

// Body parser with 100kb limit for JSON endpoints
app.use(express.json({ limit: '100kb' }))

// Mount routes
app.use('/auth', authRouter)
app.use('/enroll', enrollRouter)
app.use('/tasks', taskRouter)
app.use('/admin', adminRouter)
app.use('/verify', verifyRouter)
app.use('/internships', internshipRouter)

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Test route for error handler verification in test environment
if (env.NODE_ENV === 'test') {
  app.get('/test-error', () => {
    throw new Error('Sensitive database credentials leak test')
  })
}

interface HttpError extends Error {
  status?: number
  statusCode?: number
  type?: string
}

// Global error handler last:
// logs err.stack server-side, returns generic { error: "internal_error", requestId } to client — never err.message
export const errorHandler = (
  err: HttpError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const reqId =
    (req.id as string) || (res.getHeader('x-request-id') as string) || 'unknown'

  const status = err.status || err.statusCode || 500

  if (status >= 500) {
    logger.error(
      {
        err,
        stack: err.stack,
        requestId: reqId,
        path: req.path,
        method: req.method,
      },
      'Unhandled server error',
    )
  }

  if (res.headersSent) {
    return
  }

  if (err.name === 'CastError') {
    res.status(400).json({
      error: 'invalid_id_format',
      message: 'Invalid identifier format.',
      requestId: reqId,
    })
    return
  }

  if (err.type === 'entity.too.large' || status === 413) {
    res.status(413).json({
      error: 'payload_too_large',
      requestId: reqId,
    })
    return
  }

  if (status >= 400 && status < 500) {
    res.status(status).json({
      error: 'bad_request',
      requestId: reqId,
    })
    return
  }

  res.status(500).json({
    error: 'internal_error',
    requestId: reqId,
  })
}

app.use(errorHandler)
