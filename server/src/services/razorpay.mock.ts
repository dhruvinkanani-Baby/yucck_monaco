import crypto from 'node:crypto'
import type {
  IRazorpayService,
  CreateOrderParams,
  RazorpayOrder,
  RazorpayPayment,
  VerifyPaymentSignatureParams,
} from './razorpay.js'

export class MockRazorpayService implements IRazorpayService {
  public orders = new Map<string, RazorpayOrder>()
  public payments = new Map<string, RazorpayPayment>()
  public secret: string
  public webhookSecret: string

  constructor(
    secret = 'test_razorpay_secret_123',
    webhookSecret = 'test_webhook_secret_123',
  ) {
    this.secret = secret
    this.webhookSecret = webhookSecret
  }

  async createOrder(params: CreateOrderParams): Promise<RazorpayOrder> {
    const id = `order_${crypto.randomBytes(8).toString('hex')}`
    const order: RazorpayOrder = {
      id,
      amount: params.amount,
      currency: params.currency,
      receipt: params.receipt,
      status: 'created',
    }
    this.orders.set(id, order)
    return order
  }

  async fetchOrder(orderId: string): Promise<RazorpayOrder> {
    const order = this.orders.get(orderId)
    if (!order) {
      throw new Error(`Mock order not found: ${orderId}`)
    }
    return order
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    const payment = this.payments.get(paymentId)
    if (!payment) {
      throw new Error(`Mock payment not found: ${paymentId}`)
    }
    return payment
  }

  generateSignature(orderId: string, paymentId: string): string {
    return crypto
      .createHmac('sha256', this.secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex')
  }

  generateWebhookSignature(rawBody: string | Buffer): string {
    const buf = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(rawBody, 'utf8')
    return crypto
      .createHmac('sha256', this.webhookSecret)
      .update(buf)
      .digest('hex')
  }

  verifyPaymentSignature({
    orderId,
    paymentId,
    signature,
  }: VerifyPaymentSignatureParams): boolean {
    const expected = this.generateSignature(orderId, paymentId)
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signature),
      )
    } catch {
      return false
    }
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    const expected = this.generateWebhookSignature(rawBody)
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signature),
      )
    } catch {
      return false
    }
  }

  async refundPayment(paymentId: string, _amount?: number): Promise<unknown> {
    const payment = this.payments.get(paymentId)
    if (payment) {
      payment.status = 'refunded'
    }
    return { id: `rfnd_${paymentId}`, status: 'processed' }
  }
}
