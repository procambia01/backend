// src/services/swap.service.ts
import { prisma } from '@/config/database';
import { NotificationService } from './notification.service';
import { FeeService } from './fee.service';
import { ReferralService } from './referral.service';
import { NotFoundError, ForbiddenError, BadRequestError } from '@/utils/error.util';
import { SwapStatus, NotificationType, DisputeReason } from '@prisma/client';
import { PaginationParams } from '@/utils/pagination.util';
import logger from '@/utils/logger.util';

export class SwapService {
  private notificationService: NotificationService;
  private feeService: FeeService;
  private referralService: ReferralService;

  constructor() {
    this.notificationService = new NotificationService();
    this.feeService = new FeeService();
    this.referralService = new ReferralService();
  }

  /**
   * Get user swaps
   */
  async getUserSwaps(userId: string, pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [swaps, total] = await Promise.all([
      prisma.swap.findMany({
        where: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
        },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          offer: true,
          initiator: {
            select: {
              id: true,
              name: true,
              image: true,
              rating: true,
            },
          },
          receiver: {
            select: {
              id: true,
              name: true,
              image: true,
              rating: true,
            },
          },
        },
      }),
      prisma.swap.count({
        where: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
        },
      }),
    ]);

    return {
      data: swaps,
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
   * Get active swaps
   */
  async getActiveSwaps(userId: string) {
    return prisma.swap.findMany({
      where: {
        OR: [{ initiatorId: userId }, { receiverId: userId }],
        status: { in: [SwapStatus.PENDING, SwapStatus.AGREED, SwapStatus.IN_PROGRESS] },
      },
      include: {
        offer: true,
        initiator: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get pending swaps
   */
  async getPendingSwaps(userId: string) {
    return prisma.swap.findMany({
      where: {
        receiverId: userId,
        status: SwapStatus.PENDING,
      },
      include: {
        offer: true,
        initiator: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get completed swaps
   */
  async getCompletedSwaps(userId: string, pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [swaps, total] = await Promise.all([
      prisma.swap.findMany({
        where: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
          status: SwapStatus.COMPLETED,
        },
        skip,
        take: perPage,
        orderBy: { completedAt: 'desc' },
        include: {
          offer: true,
          initiator: {
            select: {
              id: true,
              name: true,
              image: true,
              rating: true,
            },
          },
          receiver: {
            select: {
              id: true,
              name: true,
              image: true,
              rating: true,
            },
          },
        },
      }),
      prisma.swap.count({
        where: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
          status: SwapStatus.COMPLETED,
        },
      }),
    ]);

    return {
      data: swaps,
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
   * Get swap statistics
   */
  async getSwapStatistics(userId: string) {
    const [total, pending, active, completed, cancelled, disputed] = await Promise.all([
      prisma.swap.count({
        where: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
        },
      }),
      prisma.swap.count({
        where: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
          status: SwapStatus.PENDING,
        },
      }),
      prisma.swap.count({
        where: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
          status: { in: [SwapStatus.AGREED, SwapStatus.IN_PROGRESS] },
        },
      }),
      prisma.swap.count({
        where: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
          status: SwapStatus.COMPLETED,
        },
      }),
      prisma.swap.count({
        where: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
          status: SwapStatus.CANCELLED,
        },
      }),
      prisma.swap.count({
        where: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
          status: SwapStatus.DISPUTED,
        },
      }),
    ]);

    const successRate = total > 0 ? (completed / total) * 100 : 0;

    return {
      total,
      pending,
      active,
      completed,
      cancelled,
      disputed,
      successRate: Math.round(successRate * 100) / 100,
    };
  }

  /**
   * Initiate swap
   */
  async initiateSwap(userId: string, offerId: string, message?: string) {
    const offer = await prisma.swapOffer.findUnique({
      where: { id: offerId },
      include: {
        user: true,
      },
    });

    if (!offer) {
      throw new NotFoundError('Offer not found');
    }

    if (offer.userId === userId) {
      throw new BadRequestError('You cannot swap with your own offer');
    }

    const swap = await prisma.swap.create({
      data: {
        initiatorId: userId,
        receiverId: offer.userId,
        offerId,
        initiatorGivesCurrency: offer.wantCurrency,
        initiatorGivesAmount: offer.wantAmount,
        receiverGivesCurrency: offer.haveCurrency,
        receiverGivesAmount: offer.haveAmount,
        agreedExchangeRate: offer.exchangeRate,
        status: SwapStatus.PENDING,
      },
      include: {
        initiator: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Send notification
    await this.notificationService.sendNotification(
      offer.userId,
      NotificationType.SWAP_REQUEST,
      'New Swap Request',
      `${swap.initiator.name} sent you a swap request`,
      `/swaps/${swap.id}`
    );

    // Create initial message if provided
    if (message) {
      await prisma.message.create({
        data: {
          swapId: swap.id,
          senderId: userId,
          content: message,
          messageType: 'TEXT',
        },
      });
    }

    logger.info(`Swap initiated: ${swap.id}`);

    return swap;
  }

  /**
   * Get swap by ID
   */
  async getSwapById(swapId: string, userId: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
      include: {
        offer: true,
        initiator: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
            totalSwaps: true,
            successfulSwaps: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
            totalSwaps: true,
            successfulSwaps: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this swap');
    }

    return swap;
  }

  /**
   * Accept swap
   */
  async acceptSwap(swapId: string, userId: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.receiverId !== userId) {
      throw new ForbiddenError('Only the receiver can accept the swap');
    }

    if (swap.status !== SwapStatus.PENDING) {
      throw new BadRequestError('Swap is not in pending status');
    }

    const updatedSwap = await prisma.swap.update({
      where: { id: swapId },
      data: { status: SwapStatus.AGREED },
    });

    // Send notification
    await this.notificationService.sendNotification(
      swap.initiatorId,
      NotificationType.SWAP_ACCEPTED,
      'Swap Accepted',
      'Your swap request was accepted',
      `/swaps/${swapId}`
    );

    logger.info(`Swap accepted: ${swapId}`);

    return updatedSwap;
  }

  /**
   * Reject swap
   */
  async rejectSwap(swapId: string, userId: string, reason?: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.receiverId !== userId) {
      throw new ForbiddenError('Only the receiver can reject the swap');
    }

    const updatedSwap = await prisma.swap.update({
      where: { id: swapId },
      data: {
        status: SwapStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancellationReason: reason || 'Rejected by receiver',
      },
    });

    // Send notification
    await this.notificationService.sendNotification(
      swap.initiatorId,
      NotificationType.SWAP_REJECTED,
      'Swap Rejected',
      'Your swap request was rejected',
      `/swaps/${swapId}`
    );

    logger.info(`Swap rejected: ${swapId}`);

    return updatedSwap;
  }

  /**
   * Update meetup details
   */
  async updateMeetup(swapId: string, userId: string, meetupData: any) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this swap');
    }

    const updatedSwap = await prisma.swap.update({
      where: { id: swapId },
      data: {
        meetupLocation: meetupData.location,
        meetupAddress: meetupData.address,
        meetupTime: meetupData.time ? new Date(meetupData.time) : undefined,
        meetupLatitude: meetupData.latitude,
        meetupLongitude: meetupData.longitude,
        meetupNotes: meetupData.notes,
      },
    });

    logger.info(`Meetup updated for swap: ${swapId}`);

    return updatedSwap;
  }

  /**
   * Confirm meetup details
   */
  async confirmMeetup(swapId: string, userId: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this swap');
    }

    const updatedSwap = await prisma.swap.update({
      where: { id: swapId },
      data: { status: SwapStatus.IN_PROGRESS },
    });

    logger.info(`Meetup confirmed for swap: ${swapId}`);

    return updatedSwap;
  }

  /**
   * Confirm money sent
   */
  async confirmSent(swapId: string, userId: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId === userId) {
      await prisma.swap.update({
        where: { id: swapId },
        data: {
          initiatorSentConfirmed: true,
          initiatorSentAt: new Date(),
        },
      });
    } else if (swap.receiverId === userId) {
      await prisma.swap.update({
        where: { id: swapId },
        data: {
          receiverSentConfirmed: true,
          receiverSentAt: new Date(),
        },
      });
    } else {
      throw new ForbiddenError('You do not have access to this swap');
    }

    logger.info(`Money sent confirmed by user ${userId} for swap: ${swapId}`);

    return this.checkSwapCompletion(swapId);
  }

  /**
   * Confirm money received
   */
  async confirmReceived(swapId: string, userId: string, rating?: number, comment?: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId === userId) {
      await prisma.swap.update({
        where: { id: swapId },
        data: {
          initiatorReceivedConfirmed: true,
          initiatorReceivedAt: new Date(),
        },
      });
    } else if (swap.receiverId === userId) {
      await prisma.swap.update({
        where: { id: swapId },
        data: {
          receiverReceivedConfirmed: true,
          receiverReceivedAt: new Date(),
        },
      });
    } else {
      throw new ForbiddenError('You do not have access to this swap');
    }

    // Create rating if provided
    if (rating && comment !== undefined) {
      const receiverId = swap.initiatorId === userId ? swap.receiverId : swap.initiatorId;
      await prisma.rating.create({
        data: {
          swapId,
          giverId: userId,
          receiverId,
          stars: rating,
          comment,
        },
      });
    }

    logger.info(`Money received confirmed by user ${userId} for swap: ${swapId}`);

    return this.checkSwapCompletion(swapId);
  }

  /**
   * Check swap completion
   */
  private async checkSwapCompletion(swapId: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (
      swap &&
      swap.initiatorReceivedConfirmed &&
      swap.receiverReceivedConfirmed
    ) {
      return this.completeSwap(swapId);
    }

    return swap;
  }

  /**
   * Complete swap
   */
  async completeSwap(swapId: string) {
    const swap = await prisma.swap.update({
      where: { id: swapId },
      data: {
        status: SwapStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    // Update user stats
    await Promise.all([
      prisma.user.update({
        where: { id: swap.initiatorId },
        data: {
          totalSwaps: { increment: 1 },
          successfulSwaps: { increment: 1 },
        },
      }),
      prisma.user.update({
        where: { id: swap.receiverId },
        data: {
          totalSwaps: { increment: 1 },
          successfulSwaps: { increment: 1 },
        },
      }),
    ]);

    // Send notifications
    await Promise.all([
      this.notificationService.sendNotification(
        swap.initiatorId,
        NotificationType.SWAP_COMPLETED,
        'Swap Completed',
        'Your swap has been completed successfully',
        `/swaps/${swapId}`
      ),
      this.notificationService.sendNotification(
        swap.receiverId,
        NotificationType.SWAP_COMPLETED,
        'Swap Completed',
        'Your swap has been completed successfully',
        `/swaps/${swapId}`
      ),
    ]);

    logger.info(`Swap completed: ${swapId}`);

    // Referral completion + platform fee settlement both depend on the
    // swap being marked COMPLETED and user stats being current, so they
    // run after the above. Neither should ever block the response to the
    // user — payment/referral issues are surfaced asynchronously via
    // notifications, not by failing the swap-completion request.
    try {
      await Promise.all([
        this.referralService.completeReferral(swap.initiatorId),
        this.referralService.completeReferral(swap.receiverId),
      ]);
    } catch (err) {
      logger.error(`Referral completion failed for swap ${swapId}: ${(err as Error).message}`);
    }

    try {
      await this.feeService.settleSwapFees(swap);
    } catch (err) {
      logger.error(`Fee settlement failed for swap ${swapId}: ${(err as Error).message}`);
    }

    return swap;
  }

  /**
   * Cancel swap
   */
  async cancelSwap(swapId: string, userId: string, reason: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this swap');
    }

    const updatedSwap = await prisma.swap.update({
      where: { id: swapId },
      data: {
        status: SwapStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancellationReason: reason,
      },
    });

    // Send notification to other party
    const otherUserId = swap.initiatorId === userId ? swap.receiverId : swap.initiatorId;
    await this.notificationService.sendNotification(
      otherUserId,
      NotificationType.SWAP_CANCELLED,
      'Swap Cancelled',
      'The swap has been cancelled',
      `/swaps/${swapId}`
    );

    logger.info(`Swap cancelled: ${swapId} by user ${userId}`);

    return updatedSwap;
  }

  /**
   * Report issue
   */
  async reportIssue(
    swapId: string,
    userId: string,
    issue: string,
    description: string,
    evidence?: string[]
  ) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this swap');
    }

    // Create dispute
    await prisma.dispute.create({
      data: {
        swapId,
        reporterId: userId,
        reason: issue as DisputeReason,
        description,
        evidence: evidence || [],
        status: 'OPEN',
      },
    });

    // Update swap status
    await prisma.swap.update({
      where: { id: swapId },
      data: { status: SwapStatus.DISPUTED },
    });

    logger.warn(`Issue reported for swap: ${swapId} by user ${userId}`);
  }

  /**
   * Get swap timeline
   */
  async getSwapTimeline(swapId: string, userId: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this swap');
    }

    const timeline = [];

    timeline.push({
      event: 'SWAP_INITIATED',
      timestamp: swap.createdAt,
      actor: 'initiator',
    });

    if (swap.status !== SwapStatus.PENDING) {
      timeline.push({
        event: 'SWAP_ACCEPTED',
        timestamp: swap.updatedAt,
        actor: 'receiver',
      });
    }

    if (swap.initiatorSentAt) {
      timeline.push({
        event: 'INITIATOR_SENT',
        timestamp: swap.initiatorSentAt,
        actor: 'initiator',
      });
    }

    if (swap.receiverSentAt) {
      timeline.push({
        event: 'RECEIVER_SENT',
        timestamp: swap.receiverSentAt,
        actor: 'receiver',
      });
    }

    if (swap.initiatorReceivedAt) {
      timeline.push({
        event: 'INITIATOR_RECEIVED',
        timestamp: swap.initiatorReceivedAt,
        actor: 'initiator',
      });
    }

    if (swap.receiverReceivedAt) {
      timeline.push({
        event: 'RECEIVER_RECEIVED',
        timestamp: swap.receiverReceivedAt,
        actor: 'receiver',
      });
    }

    if (swap.completedAt) {
      timeline.push({
        event: 'SWAP_COMPLETED',
        timestamp: swap.completedAt,
        actor: 'system',
      });
    }

    if (swap.cancelledAt) {
      timeline.push({
        event: 'SWAP_CANCELLED',
        timestamp: swap.cancelledAt,
        actor: swap.cancelledBy === swap.initiatorId ? 'initiator' : 'receiver',
      });
    }

    return timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Request extension
   */
  async requestExtension(swapId: string, userId: string, hours: number, reason: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this swap');
    }

    // Send notification to other party
    const otherUserId = swap.initiatorId === userId ? swap.receiverId : swap.initiatorId;
    await this.notificationService.sendNotification(
      otherUserId,
      NotificationType.SYSTEM_ALERT,
      'Extension Requested',
      `Extension of ${hours} hours requested: ${reason}`,
      `/swaps/${swapId}`
    );

    logger.info(`Extension requested for swap: ${swapId} by user ${userId}`);
  }

  /**
   * Send reminder
   */
  async sendReminder(swapId: string, userId: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this swap');
    }

    // Send reminder to other party
    const otherUserId = swap.initiatorId === userId ? swap.receiverId : swap.initiatorId;
    await this.notificationService.sendNotification(
      otherUserId,
      NotificationType.SYSTEM_ALERT,
      'Swap Reminder',
      'Please complete your part of the swap',
      `/swaps/${swapId}`
    );

    // Update reminder count
    await prisma.swap.update({
      where: { id: swapId },
      data: {
        remindersSent: { increment: 1 },
        lastReminderAt: new Date(),
      },
    });

    logger.info(`Reminder sent for swap: ${swapId}`);
  }

  /**
   * Get participants
   */
  async getParticipants(swapId: string, userId: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
      include: {
        initiator: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
            totalSwaps: true,
            successfulSwaps: true,
            idVerified: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
            totalSwaps: true,
            successfulSwaps: true,
            idVerified: true,
          },
        },
      },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this swap');
    }

    return {
      initiator: swap.initiator,
      receiver: swap.receiver,
    };
  }
}