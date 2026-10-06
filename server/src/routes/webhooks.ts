import { Router } from 'express'
import { handleRazorpayWebhook } from '../controllers/webhookController.js'

export const webhookRouter = Router()

webhookRouter.post('/razorpay', handleRazorpayWebhook)
