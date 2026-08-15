// src/controllers/subscription.controller.ts
import { Request, Response } from 'express';
import { StripeService, type PlanId } from '@/services/stripe.service';
import { FeeService } from '@/services/fee.service';
import { OfferService } from '@/services/offer.service';
import { UserService } from '@/services/user.service';
import ResponseUtil from '@/utils/response.util';
import { config } from '@/config/env';

export class SubscriptionController {
  private stripeService = new StripeService();
  private feeService = new FeeService();
  private offerService = new OfferService();
  private userService = new UserService();

  /** GET /subscriptions/plans */
  getPlans = async (_req: Request, res: Response): Promise<Response> => {
    const plans = this.stripeService.getPlans();
    return ResponseUtil.success(res, plans);
  };

  /** GET /subscriptions/current */
  getCurrentSubscription = async (req: Request, res: Response): Promise<Response> => {
    const sub = await this.stripeService.getActiveSubscription(req.user!.userId);
    return ResponseUtil.success(res, sub ?? null);
  };

  /** POST /subscriptions/checkout */
  createCheckout = async (req: Request, res: Response): Promise<Response> => {
    const { planId } = req.body as { planId: PlanId };
    const origin = req.headers.origin ?? config.appUrl;
    const result = await this.stripeService.createCheckoutSession(
      req.user!.userId,
      planId,
      `${origin}/dashboard/premium/success`,
      `${origin}/dashboard/premium`,
    );
    return ResponseUtil.success(res, result);
  };

  /** POST /subscriptions/portal */
  createPortal = async (req: Request, res: Response): Promise<Response> => {
    const origin = req.headers.origin ?? config.appUrl;
    const result = await this.stripeService.createPortalSession(
      req.user!.userId,
      `${origin}/dashboard/premium`,
    );
    return ResponseUtil.success(res, result);
  };

  /** POST /subscriptions/cancel */
  cancelSubscription = async (req: Request, res: Response): Promise<Response> => {
    const { immediately = false } = req.body as { immediately?: boolean };
    const result = await this.stripeService.cancelSubscription(req.user!.userId, immediately);
    return ResponseUtil.success(res, result, 'Subscription cancelled successfully');
  };

  /** POST /webhooks/stripe  (raw body — no auth middleware) */
  handleWebhook = async (req: Request, res: Response): Promise<Response> => {
    const signature = req.headers['stripe-signature'] as string;

    let event;
    try {
      event = this.stripeService.constructWebhookEvent(req.body as Buffer, signature);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Webhook error';
      return res.status(400).send(`Webhook Error: ${msg}`) as unknown as Response;
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.stripeService.handleSubscriptionActivated(event.data.object as any);
        break;
      case 'customer.subscription.deleted':
        await this.stripeService.handleSubscriptionDeleted(event.data.object as any);
        break;
      case 'invoice.payment_succeeded':
        await this.stripeService.handleInvoicePaid(event.data.object as any);
        break;
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const type = session.metadata?.type;
        if (type === 'SWAP_FEE') {
          await this.feeService.handleFeeCheckoutCompleted(session);
        } else if (type === 'BOOST_OFFER') {
          await this.offerService.handleBoostCheckoutCompleted(session);
        } else if (type === 'VERIFICATION_FEE') {
          await this.userService.handleVerificationCheckoutCompleted(session);
        } else if (type === 'PARTNER_ACCESS') {
          await this.userService.handlePartnerCheckoutCompleted(session);
        }
        // Subscription checkouts also fire this event, but their state
        // is already fully handled by customer.subscription.created above.
        break;
      }
      default:
        break;
    }

    return ResponseUtil.success(res, { received: true });
  };
}
