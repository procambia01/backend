// src/controllers/webhook.controller.ts
import { Request, Response } from 'express';
import { WebhookService } from '@/services/webhook.service';
import ResponseUtil from '@/utils/response.util';
import logger from '@/utils/logger.util';

export class WebhookController {
  private webhookService: WebhookService;

  constructor() {
    this.webhookService = new WebhookService();
  }

  /**
   * Handle Stripe webhook
   */
  handleStripeWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
      const signature = req.headers['stripe-signature'] as string;
      const payload = JSON.stringify(req.body);

      await this.webhookService.handleStripeWebhook(payload, signature);

      return ResponseUtil.success(res, { received: true });
    } catch (error) {
      logger.error('Stripe webhook error:', error);
      return ResponseUtil.badRequest(res, 'Webhook processing failed');
    }
  };

  /**
   * Handle Paystack webhook
   */
  handlePaystackWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
      const signature = req.headers['x-paystack-signature'] as string;
      const payload = JSON.stringify(req.body);

      await this.webhookService.handlePaystackWebhook(payload, signature);

      return ResponseUtil.success(res, { received: true });
    } catch (error) {
      logger.error('Paystack webhook error:', error);
      return ResponseUtil.badRequest(res, 'Webhook processing failed');
    }
  };

  /**
   * Handle Flutterwave webhook
   */
  handleFlutterwaveWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
      const signature = req.headers['verif-hash'] as string;
      const payload = JSON.stringify(req.body);

      await this.webhookService.handleFlutterwaveWebhook(payload, signature);

      return ResponseUtil.success(res, { received: true });
    } catch (error) {
      logger.error('Flutterwave webhook error:', error);
      return ResponseUtil.badRequest(res, 'Webhook processing failed');
    }
  };
}