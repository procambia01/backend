import Stripe from 'stripe';
import { prisma } from '@/config/database';
import config from '@/config/env';
import { computeSwapFee } from '@/config/monetization';
import { NotificationService } from '@/services/notification.service';
import { SwapFeeStatus, TransactionType, TransactionStatus, NotificationType } from '@prisma/client';
import logger from '@/utils/logger.util';

const stripe = new Stripe(config.payment.stripe.secretKey ?? '', {
  apiVersion: '2025-02-24.acacia',
});

const notificationService = new NotificationService();

interface SwapForFee {
  id: string;
  initiatorId: string;
  receiverId: string;
  initiatorGivesAmount: number;
  initiatorGivesCurrency: string;
  receiverGivesAmount: number;
  receiverGivesCurrency: string;
}

export class FeeService {
  /**
   * Called from SwapService.completeSwap(). Computes each side's fee,
   * applies premium/referral waivers, and attempts to collect payment
   * via the user's saved Stripe payment method (off-session). If a user
   * has no saved payment method, the fee is left PENDING and surfaced
   * in-app via GET /swaps/:id/fee so the client can prompt payment
   * through a Checkout Session (see collectFeeViaCheckout below).
   */
  async settleSwapFees(swap: SwapForFee) {
    const [initiator, receiver] = await Promise.all([
      prisma.user.findUnique({ where: { id: swap.initiatorId } }),
      prisma.user.findUnique({ where: { id: swap.receiverId } }),
    ]);
    if (!initiator || !receiver) return;

    const [initiatorWaived, receiverWaived] = await Promise.all([
      this.shouldWaiveFee(initiator),
      this.shouldWaiveFee(receiver),
    ]);

    const initiatorFeeAmount = computeSwapFee(
      swap.initiatorGivesAmount,
      swap.initiatorGivesCurrency
    );
    const receiverFeeAmount = computeSwapFee(
      swap.receiverGivesAmount,
      swap.receiverGivesCurrency
    );

    await prisma.swap.update({
      where: { id: swap.id },
      data: {
        initiatorFeeAmount,
        initiatorFeeWaived: initiatorWaived,
        receiverFeeAmount,
        receiverFeeWaived: receiverWaived,
        feeStatus: SwapFeeStatus.PENDING,
      },
    });

    const [initiatorResult, receiverResult] = await Promise.all([
      initiatorWaived
        ? Promise.resolve(true)
        : this.tryOffSessionCharge(
            initiator,
            swap.id,
            initiatorFeeAmount,
            swap.initiatorGivesCurrency,
            'initiator'
          ),
      receiverWaived
        ? Promise.resolve(true)
        : this.tryOffSessionCharge(
            receiver,
            swap.id,
            receiverFeeAmount,
            swap.receiverGivesCurrency,
            'receiver'
          ),
    ]);

    // Recompute the aggregate status now that both sides have settled
    // (or failed/are pending manual payment via Checkout).
    const finalSwap = await prisma.swap.findUnique({ where: { id: swap.id } });
    if (!finalSwap) return;

    const bothSettled =
      (finalSwap.initiatorFeeWaived || finalSwap.initiatorFeePaidAt) &&
      (finalSwap.receiverFeeWaived || finalSwap.receiverFeePaidAt);
    const noneSettled =
      !finalSwap.initiatorFeeWaived &&
      !finalSwap.initiatorFeePaidAt &&
      !finalSwap.receiverFeeWaived &&
      !finalSwap.receiverFeePaidAt;

    await prisma.swap.update({
      where: { id: swap.id },
      data: {
        feeStatus: bothSettled
          ? SwapFeeStatus.PAID
          : noneSettled
            ? SwapFeeStatus.FAILED
            : SwapFeeStatus.PARTIALLY_PAID,
      },
    });

    // If either side still owes a fee, let them know so they can pay
    // via GET /swaps/:id/fee/checkout in-app.
    if (!initiatorResult) {
      await notificationService.sendNotification(
        initiator.id,
        NotificationType.SYSTEM_ALERT,
        'Swap fee due',
        `A small ${swap.initiatorGivesCurrency} ${initiatorFeeAmount.toFixed(2)} platform fee is due on your completed swap. Premium members swap fee-free.`,
        `/swaps/${swap.id}`
      );
    }
    if (!receiverResult) {
      await notificationService.sendNotification(
        receiver.id,
        NotificationType.SYSTEM_ALERT,
        'Swap fee due',
        `A small ${swap.receiverGivesCurrency} ${receiverFeeAmount.toFixed(2)} platform fee is due on your completed swap. Premium members swap fee-free.`,
        `/swaps/${swap.id}`
      );
    }
  }

  /**
   * A user's fee is waived if they're premium, OR if this is the first
   * completed swap for a user who was referred and referral rewards are
   * still enabled (see MONETIZATION.referral.firstSwapFeeWaived).
   */
  private async shouldWaiveFee(user: { id: string; isPremium: boolean; premiumExpiry: Date | null }) {
    if (user.isPremium && (!user.premiumExpiry || user.premiumExpiry > new Date())) {
      return true;
    }

    const referral = await prisma.referral.findFirst({
      where: { referredId: user.id, status: { in: ['PENDING', 'COMPLETED'] } },
    });
    if (!referral) return false;

    // "First swap" = the referred user has no other COMPLETED swap yet.
    const priorCompletedSwaps = await prisma.swap.count({
      where: {
        status: 'COMPLETED',
        OR: [{ initiatorId: user.id }, { receiverId: user.id }],
      },
    });
    // At the point this runs, the CURRENT swap hasn't been marked
    // COMPLETED with fee settlement yet in this count context, so
    // priorCompletedSwaps === 1 means "this is that first swap".
    return priorCompletedSwaps <= 1;
  }

  private async tryOffSessionCharge(
    user: { id: string; stripeCustomerId: string | null },
    swapId: string,
    amount: number,
    currency: string,
    side: 'initiator' | 'receiver'
  ): Promise<boolean> {
    if (!user.stripeCustomerId || amount <= 0) return false;

    try {
      const methods = await stripe.paymentMethods.list({
        customer: user.stripeCustomerId,
        type: 'card',
      });
      if (methods.data.length === 0) return false;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        customer: user.stripeCustomerId,
        payment_method: methods.data[0].id,
        off_session: true,
        confirm: true,
        metadata: { type: 'SWAP_FEE', swapId, side, userId: user.id },
      });

      if (paymentIntent.status !== 'succeeded') return false;

      await prisma.$transaction([
        prisma.swap.update({
          where: { id: swapId },
          data:
            side === 'initiator'
              ? { initiatorFeePaidAt: new Date() }
              : { receiverFeePaidAt: new Date() },
        }),
        prisma.transaction.create({
          data: {
            userId: user.id,
            type: TransactionType.SWAP_FEE,
            amount,
            currency: currency.toUpperCase(),
            description: `Platform fee for swap ${swapId}`,
            status: TransactionStatus.COMPLETED,
            paymentGateway: 'stripe',
            gatewayTransactionId: paymentIntent.id,
            platformFee: amount,
            completedAt: new Date(),
          },
        }),
      ]);

      return true;
    } catch (err) {
      logger.warn(`Off-session swap fee charge failed for user ${user.id}: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Fallback for users without a saved card: a hosted Checkout Session
   * they can pay through in-app. Called from GET /swaps/:id/fee/checkout.
   */
  async createFeeCheckoutSession(
    userId: string,
    swapId: string,
    side: 'initiator' | 'receiver',
    amount: number,
    currency: string,
    origin: string
  ) {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: Math.round(amount * 100),
            product_data: { name: 'Cashmova platform fee' },
          },
          quantity: 1,
        },
      ],
      metadata: { type: 'SWAP_FEE', swapId, side, userId },
      success_url: `${origin}/dashboard/swaps/${swapId}?fee=paid`,
      cancel_url: `${origin}/dashboard/swaps/${swapId}?fee=cancelled`,
    });
    return session;
  }

  /**
   * Invoked from the Stripe webhook on checkout.session.completed
   * for sessions whose metadata.type === 'SWAP_FEE'.
   */
  async handleFeeCheckoutCompleted(session: Stripe.Checkout.Session) {
    const { swapId, side, userId } = session.metadata ?? {};
    if (!swapId || !side || !userId) return;

    const amount = (session.amount_total ?? 0) / 100;
    const currency = (session.currency ?? 'usd').toUpperCase();

    await prisma.$transaction([
      prisma.swap.update({
        where: { id: swapId },
        data:
          side === 'initiator'
            ? { initiatorFeePaidAt: new Date() }
            : { receiverFeePaidAt: new Date() },
      }),
      prisma.transaction.create({
        data: {
          userId,
          type: TransactionType.SWAP_FEE,
          amount,
          currency,
          description: `Platform fee for swap ${swapId}`,
          status: TransactionStatus.COMPLETED,
          paymentGateway: 'stripe',
          gatewayTransactionId: session.id,
          platformFee: amount,
          completedAt: new Date(),
        },
      }),
    ]);

    const swap = await prisma.swap.findUnique({ where: { id: swapId } });
    if (!swap) return;
    const bothSettled =
      (swap.initiatorFeeWaived || swap.initiatorFeePaidAt) &&
      (swap.receiverFeeWaived || swap.receiverFeePaidAt);
    if (bothSettled) {
      await prisma.swap.update({
        where: { id: swapId },
        data: { feeStatus: SwapFeeStatus.PAID },
      });
    }

    logger.info(`Swap fee paid via Checkout — swap ${swapId}, side ${side}`);
  }
}
