// src/services/webhook.service.ts
import crypto from 'crypto';
import { prisma } from '@/config/database';
import { TransactionService } from './transaction.service';
import { config } from '@/config/env';
import logger from '@/utils/logger.util';
import { BadRequestError } from '@/utils/error.util';

export class WebhookService {
  private transactionService: TransactionService;

  constructor() {
    this.transactionService = new TransactionService();
  }

  /**
   * Handle Stripe webhook
   */
  async handleStripeWebhook(payload: any, signature: string) {
    // Verify Stripe signature
    const isValid = this.verifyStripeSignature(payload, signature);

    if (!isValid) {
      throw new BadRequestError('Invalid Stripe signature');
    }

    const event = JSON.parse(payload);

    logger.info(`Stripe webhook received: ${event.type}`);

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handleStripePaymentSuccess(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await this.handleStripePaymentFailed(event.data.object);
        break;

      case 'charge.refunded':
        await this.handleStripeRefund(event.data.object);
        break;

      default:
        logger.info(`Unhandled Stripe event type: ${event.type}`);
    }

    return { received: true };
  }

  /**
   * Handle Paystack webhook
   */
  async handlePaystackWebhook(payload: any, signature: string) {
    // Verify Paystack signature
    const isValid = this.verifyPaystackSignature(payload, signature);

    if (!isValid) {
      throw new BadRequestError('Invalid Paystack signature');
    }

    const event = JSON.parse(payload);

    logger.info(`Paystack webhook received: ${event.event}`);

    switch (event.event) {
      case 'charge.success':
        await this.handlePaystackPaymentSuccess(event.data);
        break;

      case 'charge.failed':
        await this.handlePaystackPaymentFailed(event.data);
        break;

      case 'refund.processed':
        await this.handlePaystackRefund(event.data);
        break;

      default:
        logger.info(`Unhandled Paystack event: ${event.event}`);
    }

    return { received: true };
  }

  /**
   * Handle Flutterwave webhook
   */
  async handleFlutterwaveWebhook(payload: any, signature: string) {
    // Verify Flutterwave signature
    const isValid = this.verifyFlutterwaveSignature(payload, signature);

    if (!isValid) {
      throw new BadRequestError('Invalid Flutterwave signature');
    }

    const event = JSON.parse(payload);

    logger.info(`Flutterwave webhook received: ${event.event}`);

    switch (event.event) {
      case 'charge.completed':
        await this.handleFlutterwavePaymentSuccess(event.data);
        break;

      case 'charge.failed':
        await this.handleFlutterwavePaymentFailed(event.data);
        break;

      default:
        logger.info(`Unhandled Flutterwave event: ${event.event}`);
    }

    return { received: true };
  }

  /**
   * Verify Stripe signature
   */
  private verifyStripeSignature(payload: string, signature: string): boolean {
    try {
      const secret = config.payment.stripe.webhookSecret;
      
      if (!secret) {
        logger.warn('Stripe webhook secret not configured');
        return false;
      }

      const timestamp = signature.split(',')[0].split('=')[1];
      const signatureHash = signature.split(',')[1].split('=')[1];

      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${payload}`)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signatureHash),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      logger.error('Stripe signature verification error:', error);
      return false;
    }
  }

  /**
   * Verify Paystack signature
   */
  private verifyPaystackSignature(payload: string, signature: string): boolean {
    try {
      const secret = config.payment.paystack.secretKey;
      
      if (!secret) {
        logger.warn('Paystack secret key not configured');
        return false;
      }

      const hash = crypto
        .createHmac('sha512', secret)
        .update(payload)
        .digest('hex');

      return hash === signature;
    } catch (error) {
      logger.error('Paystack signature verification error:', error);
      return false;
    }
  }

  /**
   * Verify Flutterwave signature
   */
  private verifyFlutterwaveSignature(payload: string, signature: string): boolean {
    try {
      const secret = config.payment.flutterwave.encryptionKey;
      
      if (!secret) {
        logger.warn('Flutterwave encryption key not configured');
        return false;
      }

      const hash = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      return hash === signature;
    } catch (error) {
      logger.error('Flutterwave signature verification error:', error);
      return false;
    }
  }

  /**
   * Handle Stripe payment success
   */
  private async handleStripePaymentSuccess(paymentIntent: any) {
    const transactionId = paymentIntent.metadata.transactionId;

    if (!transactionId) {
      logger.warn('No transaction ID in Stripe payment intent metadata');
      return;
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      logger.warn(`Transaction not found: ${transactionId}`);
      return;
    }

    await this.transactionService.completeTransaction(transactionId);

    logger.info(`Stripe payment succeeded for transaction: ${transactionId}`);
  }

  /**
   * Handle Stripe payment failed
   */
  private async handleStripePaymentFailed(paymentIntent: any) {
    const transactionId = paymentIntent.metadata.transactionId;

    if (!transactionId) {
      logger.warn('No transaction ID in Stripe payment intent metadata');
      return;
    }

    await this.transactionService.failTransaction(
      transactionId,
      paymentIntent.last_payment_error?.message || 'Payment failed'
    );

    logger.warn(`Stripe payment failed for transaction: ${transactionId}`);
  }

  /**
   * Handle Stripe refund
   */
  private async handleStripeRefund(charge: any) {
    const transactionId = charge.metadata.transactionId;

    if (!transactionId) {
      logger.warn('No transaction ID in Stripe charge metadata');
      return;
    }

    // Handle refund logic
    logger.info(`Stripe refund processed for transaction: ${transactionId}`);
  }

  /**
   * Handle Paystack payment success
   */
  private async handlePaystackPaymentSuccess(data: any) {
    const transactionId = data.metadata.transactionId;

    if (!transactionId) {
      logger.warn('No transaction ID in Paystack payment metadata');
      return;
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      logger.warn(`Transaction not found: ${transactionId}`);
      return;
    }

    await this.transactionService.completeTransaction(transactionId);

    logger.info(`Paystack payment succeeded for transaction: ${transactionId}`);
  }

  /**
   * Handle Paystack payment failed
   */
  private async handlePaystackPaymentFailed(data: any) {
    const transactionId = data.metadata.transactionId;

    if (!transactionId) {
      logger.warn('No transaction ID in Paystack payment metadata');
      return;
    }

    await this.transactionService.failTransaction(
      transactionId,
      data.gateway_response || 'Payment failed'
    );

    logger.warn(`Paystack payment failed for transaction: ${transactionId}`);
  }

  /**
   * Handle Paystack refund
   */
  private async handlePaystackRefund(data: any) {
    const transactionId = data.metadata.transactionId;

    if (!transactionId) {
      logger.warn('No transaction ID in Paystack refund metadata');
      return;
    }

    logger.info(`Paystack refund processed for transaction: ${transactionId}`);
  }

  /**
   * Handle Flutterwave payment success
   */
  private async handleFlutterwavePaymentSuccess(data: any) {
    const transactionId = data.tx_ref;

    if (!transactionId) {
      logger.warn('No transaction reference in Flutterwave payment');
      return;
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      logger.warn(`Transaction not found: ${transactionId}`);
      return;
    }

    await this.transactionService.completeTransaction(transactionId);

    logger.info(`Flutterwave payment succeeded for transaction: ${transactionId}`);
  }

  /**
   * Handle Flutterwave payment failed
   */
  private async handleFlutterwavePaymentFailed(data: any) {
    const transactionId = data.tx_ref;

    if (!transactionId) {
      logger.warn('No transaction reference in Flutterwave payment');
      return;
    }

    await this.transactionService.failTransaction(
      transactionId,
      data.processor_response || 'Payment failed'
    );

    logger.warn(`Flutterwave payment failed for transaction: ${transactionId}`);
  }
}