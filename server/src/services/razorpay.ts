import crypto from 'node:crypto'
import Razorpay from 'razorpay'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

export interface CreateOrderParams {
  amount: number
  currency: string
  receipt?: string
  notes?: Record<string, string>
}

export interface RazorpayOrder {
  id: string
  amount: number
  currency: string
  receipt?: string
  status: string
}

export interface RazorpayPayment {
  id: string
  order_id: string
  amount: number
  currency: string
  status: 'captured' | 'authorized' | 'failed' | 'refunded'
  method?: string
  email?: string
  contact?: string
}

export interface VerifyPaymentSignatureParams {
  orderId: string
  paymentId: string
  signature: string
}

export interface IRazorpayService {
  createOrder(params: CreateOrderParams): Promise<RazorpayOrder>
  fetchOrder(orderId: string): Promise<RazorpayOrder>
  fetchPayment(paymentId: string): Promise<RazorpayPayment>
  verifyPaymentSignature(params: VerifyPaymentSignatureParams): boolean
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean
  refundPayment(paymentId: string, amount?: number): Promise<unknown>
}

export class RazorpayServiceImpl implements IRazorpayService {
  private client: Razorpay

  constructor() {
    this.client = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    })
  }

  async createOrder(params: CreateOrderParams): Promise<RazorpayOrder> {
    try {
      const order = await this.client.orders.create({
        amount: params.amount,
        currency: params.currency,
        receipt: params.receipt,
        notes: params.notes,
      })

      return {
        id: order.id,
        amount: Number(order.amount),
        currency: order.currency,
        receipt: order.receipt,
        status: order.status,
      }
    } catch (err) {
      logger.error({ err, params }, 'Razorpay create order failed')
      throw err
    }
  }

  async fetchOrder(orderId: string): Promise<RazorpayOrder> {
    try {
      const order = await this.client.orders.fetch(orderId)
      return {
        id: order.id,
        amount: Number(order.amount),
        currency: order.currency,
        receipt: order.receipt,
        status: order.status,
      }
    } catch (err) {
      logger.error({ err, orderId }, 'Razorpay fetch order failed')
      throw err
    }
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    try {
      const payment = await this.client.payments.fetch(paymentId)
      return {
        id: payment.id,
        order_id: String(payment.order_id),
        amount: Number(payment.amount),
        currency: payment.currency,
        status: payment.status as RazorpayPayment['status'],
        method: payment.method,
        email: payment.email,
        contact: payment.contact ? String(payment.contact) : undefined,
      }
    } catch (err) {
      logger.error({ err, paymentId }, 'Razorpay fetch payment failed')
      throw err
    }
  }

  verifyPaymentSignature({
    orderId,
    paymentId,
    signature,
  }: VerifyPaymentSignatureParams): boolean {
    if (!orderId || !paymentId || !signature) {
      return false
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest('hex')

      const expectedBuf = Buffer.from(expectedSignature)
      const actualBuf = Buffer.from(signature)

      if (expectedBuf.length !== actualBuf.length) {
        return false
      }

      return crypto.timingSafeEqual(expectedBuf, actualBuf)
    } catch {
      return false
    }
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!rawBody || !signature) {
      return false
    }

    try {
      const bodyBuffer = Buffer.isBuffer(rawBody)
        ? rawBody
        : Buffer.from(rawBody, 'utf8')

      const expectedSignature = crypto
        .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
        .update(bodyBuffer)
        .digest('hex')

      const expectedBuf = Buffer.from(expectedSignature)
      const actualBuf = Buffer.from(signature)

      if (expectedBuf.length !== actualBuf.length) {
        return false
      }

      return crypto.timingSafeEqual(expectedBuf, actualBuf)
    } catch {
      return false
    }
  }

  async refundPayment(paymentId: string, amount?: number): Promise<unknown> {
    try {
      return await this.client.payments.refund(paymentId, {
        amount,
      })
    } catch (err) {
      logger.error({ err, paymentId, amount }, 'Razorpay refund failed')
      throw err
    }
  }
}

export const razorpayService: IRazorpayService = new RazorpayServiceImpl()
