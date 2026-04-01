// src/services/transaction.service.ts
import { prisma } from '@/config/database';
import { NotFoundError, ForbiddenError, BadRequestError } from '@/utils/error.util';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { PaginationParams } from '@/utils/pagination.util';
import logger from '@/utils/logger.util';

export class TransactionService {
  /**
   * Get user transactions
   */
  async getUserTransactions(userId: string, pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.count({
        where: { userId },
      }),
    ]);

    return {
      data: transactions,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
        hasMore: page < Math.ceil(total / perPage),
      },
    };
  }

  /**
   * Get transaction summary
   */
  async getTransactionSummary(userId: string) {
    const [total, completed, pending, failed, byType, totalSpent, totalEarned] =
      await Promise.all([
        prisma.transaction.count({
          where: { userId },
        }),
        prisma.transaction.count({
          where: {
            userId,
            status: TransactionStatus.COMPLETED,
          },
        }),
        prisma.transaction.count({
          where: {
            userId,
            status: TransactionStatus.PENDING,
          },
        }),
        prisma.transaction.count({
          where: {
            userId,
            status: TransactionStatus.FAILED,
          },
        }),
        prisma.transaction.groupBy({
          by: ['type'],
          where: { userId },
          _count: {
            type: true,
          },
        }),
        prisma.transaction.aggregate({
          where: {
            userId,
            status: TransactionStatus.COMPLETED,
            type: {
              in: [
                TransactionType.VERIFICATION_FEE,
                TransactionType.PREMIUM_SUBSCRIPTION,
                TransactionType.PREMIUM_UPGRADE,
                TransactionType.SECURITY_DEPOSIT,
                TransactionType.DISPUTE_FEE,
                TransactionType.FEATURED_LISTING,
                TransactionType.BOOST_OFFER,
              ],
            },
          },
          _sum: {
            amount: true,
          },
        }),
        prisma.transaction.aggregate({
          where: {
            userId,
            status: TransactionStatus.COMPLETED,
            type: {
              in: [
                TransactionType.SECURITY_DEPOSIT_REFUND,
                TransactionType.REFERRAL_BONUS,
              ],
            },
          },
          _sum: {
            amount: true,
          },
        }),
      ]);

    const transactionsByType: Record<string, number> = {};
    byType.forEach(item => {
      transactionsByType[item.type] = item._count.type;
    });

    return {
      total,
      completed,
      pending,
      failed,
      byType: transactionsByType,
      totalSpent: Number(totalSpent._sum.amount || 0),
      totalEarned: Number(totalEarned._sum.amount || 0),
    };
  }

  /**
   * Get transaction by ID
   */
  async getTransactionById(transactionId: string, userId: string) {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    if (transaction.userId !== userId) {
      throw new ForbiddenError('You do not have access to this transaction');
    }

    return transaction;
  }

  /**
   * Create transaction
   */
  async createTransaction(
    userId: string,
    type: TransactionType,
    amount: number,
    description: string,
    metadata?: any
  ) {
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        type,
        amount,
        description,
        status: TransactionStatus.PENDING,
        metadata: metadata || {},
      },
    });

    logger.info(`Transaction created: ${transaction.id} for user ${userId}`);

    return transaction;
  }

  /**
   * Verify payment
   */
  async verifyPayment(transactionId: string, gateway: string, userId: string) {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    if (transaction.userId !== userId) {
      throw new ForbiddenError('You do not have access to this transaction');
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      throw new BadRequestError('Transaction is not in pending status');
    }

    // Here you would integrate with actual payment gateway
    // For now, we'll simulate verification
    let verified = false;

    switch (gateway.toLowerCase()) {
      case 'paystack':
        verified = await this.verifyPaystackPayment(transaction);
        break;
      case 'stripe':
        verified = await this.verifyStripePayment(transaction);
        break;
      default:
        throw new BadRequestError('Unsupported payment gateway');
    }

    if (verified) {
      await this.completeTransaction(transactionId);
      return { verified: true, message: 'Payment verified successfully' };
    } else {
      await this.failTransaction(transactionId);
      return { verified: false, message: 'Payment verification failed' };
    }
  }

  /**
   * Verify Paystack payment
   */
  private async verifyPaystackPayment(transaction: any): Promise<boolean> {
    // TODO: Implement actual Paystack verification
    // For now, return true as placeholder
    logger.info(`Verifying Paystack payment for transaction: ${transaction.id}`);
    return true;
  }

  /**
   * Verify Stripe payment
   */
  private async verifyStripePayment(transaction: any): Promise<boolean> {
    // TODO: Implement actual Stripe verification
    // For now, return true as placeholder
    logger.info(`Verifying Stripe payment for transaction: ${transaction.id}`);
    return true;
  }

  /**
   * Complete transaction
   */
  async completeTransaction(transactionId: string) {
    const transaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TransactionStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    // Handle transaction type specific actions
    await this.handleCompletedTransaction(transaction);

    logger.info(`Transaction completed: ${transactionId}`);

    return transaction;
  }

  /**
   * Fail transaction
   */
  async failTransaction(transactionId: string, reason?: string) {
    const transaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TransactionStatus.FAILED,
        failedAt: new Date(),
        metadata: {
          failureReason: reason,
        },
      },
    });

    logger.warn(`Transaction failed: ${transactionId} - ${reason}`);

    return transaction;
  }

  /**
   * Refund transaction
   */
  async refundTransaction(transactionId: string, userId: string, reason: string) {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    if (transaction.userId !== userId) {
      throw new ForbiddenError('You do not have access to this transaction');
    }

    if (transaction.status !== TransactionStatus.COMPLETED) {
      throw new BadRequestError('Only completed transactions can be refunded');
    }

    // Get existing metadata or use empty object
    const existingMetadata = (transaction.metadata as Record<string, any>) || {};

    const refundedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TransactionStatus.REFUNDED,
        refundedAt: new Date(),
        metadata: {
          ...existingMetadata,
          refundReason: reason,
        },
      },
    });

    logger.info(`Transaction refunded: ${transactionId} - ${reason}`);

    return refundedTransaction;
  }

  /**
   * Handle completed transaction
   */
  private async handleCompletedTransaction(transaction: any) {
    switch (transaction.type) {
      case TransactionType.PREMIUM_SUBSCRIPTION:
      case TransactionType.PREMIUM_UPGRADE:
        await this.activatePremium(transaction.userId);
        break;

      case TransactionType.VERIFICATION_FEE:
        await this.markVerificationPaid(transaction.userId);
        break;

      case TransactionType.SECURITY_DEPOSIT:
        await this.holdSecurityDeposit(transaction);
        break;

      default:
        logger.info(`No special handling for transaction type: ${transaction.type}`);
    }
  }

  /**
   * Activate premium subscription
   */
  private async activatePremium(userId: string) {
    const premiumExpiry = new Date();
    premiumExpiry.setMonth(premiumExpiry.getMonth() + 1); // 1 month subscription

    await prisma.user.update({
      where: { id: userId },
      data: {
        isPremium: true,
        premiumExpiry,
      },
    });

    logger.info(`Premium activated for user: ${userId}`);
  }

  /**
   * Mark verification as paid
   */
  private async markVerificationPaid(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        verificationFeePaid: true,
      },
    });

    logger.info(`Verification fee paid for user: ${userId}`);
  }

  /**
   * Hold security deposit
   */
  private async holdSecurityDeposit(transaction: any) {
    await prisma.securityDeposit.create({
      data: {
        userId: transaction.userId,
        amount: transaction.amount,
        currency: transaction.currency,
        status: 'HELD',
      },
    });

    logger.info(`Security deposit held for user: ${transaction.userId}`);
  }

  /**
   * Get pending transactions
   */
  async getPendingTransactions(userId: string) {
    return prisma.transaction.findMany({
      where: {
        userId,
        status: TransactionStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Cancel transaction
   */
  async cancelTransaction(transactionId: string, userId: string) {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    if (transaction.userId !== userId) {
      throw new ForbiddenError('You do not have access to this transaction');
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      throw new BadRequestError('Only pending transactions can be cancelled');
    }

    const cancelledTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TransactionStatus.CANCELLED,
      },
    });

    logger.info(`Transaction cancelled: ${transactionId}`);

    return cancelledTransaction;
  }

  /**
   * Get transaction statistics
   */
  async getTransactionStats(userId: string, period: 'week' | 'month' | 'year' = 'month') {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const [totalAmount, count] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          userId,
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: startDate },
        },
        _sum: {
          amount: true,
        },
      }),
      prisma.transaction.count({
        where: {
          userId,
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: startDate },
        },
      }),
    ]);

    return {
      period,
      totalAmount: Number(totalAmount._sum.amount || 0),
      count,
      averageAmount: count > 0 ? Number(totalAmount._sum.amount || 0) / count : 0,
    };
  }
}