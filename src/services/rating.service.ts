// src/services/rating.service.ts
import { prisma } from '@/config/database';
import { PaginationParams } from '@/utils/pagination.util';
import { NotFoundError, ForbiddenError, BadRequestError } from '@/utils/error.util';
import logger from '@/utils/logger.util';

export class RatingService {
  /**
   * Create a rating
   */
  async createRating(userId: string, ratingData: any) {
    // Validate swap exists and user is part of it
    const swap = await prisma.swap.findUnique({
      where: { id: ratingData.swapId },
      include: {
        initiator: true,
        receiver: true,
      },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    // Check if user is part of the swap
    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You can only rate swaps you participated in');
    }

    // Determine receiver (the other person in the swap)
    const receiverId = swap.initiatorId === userId ? swap.receiverId : swap.initiatorId;

    // Check if rating already exists
    const existingRating = await prisma.rating.findUnique({
      where: {
        swapId_giverId: {
          swapId: ratingData.swapId,
          giverId: userId,
        },
      },
    });

    if (existingRating) {
      throw new BadRequestError('You have already rated this swap');
    }

    // Validate star rating
    if (ratingData.stars < 1 || ratingData.stars > 5) {
      throw new BadRequestError('Stars must be between 1 and 5');
    }

    // Create rating
    const rating = await prisma.rating.create({
      data: {
        swapId: ratingData.swapId,
        giverId: userId,
        receiverId,
        stars: ratingData.stars,
        comment: ratingData.comment,
        punctuality: ratingData.punctuality,
        communication: ratingData.communication,
        professionalism: ratingData.professionalism,
        safety: ratingData.safety,
      },
      include: {
        giver: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    // Update user's average rating
    await this.updateUserRating(receiverId);

    // Send notification
    await prisma.notification.create({
      data: {
        userId: receiverId,
        type: 'RATING_RECEIVED',
        title: 'New Rating',
        message: `${rating.giver.name} rated you ${ratingData.stars} stars`,
        link: `/ratings/${rating.id}`,
      },
    });

    logger.info(`Rating created: ${rating.id} for swap ${ratingData.swapId}`);

    return rating;
  }

  /**
   * Update user's average rating
   */
  private async updateUserRating(userId: string) {
    const ratings = await prisma.rating.aggregate({
      where: { 
        receiverId: userId,
        isHidden: false,
      },
      _avg: { stars: true },
      _count: true,
    });

    await prisma.user.update({
      where: { id: userId },
      data: { 
        rating: ratings._avg.stars || 0,
      },
    });

    logger.info(`Updated rating for user ${userId}: ${ratings._avg.stars || 0}`);
  }

  /**
   * Get ratings for a user
   */
  async getUserRatings(userId: string, pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [ratings, total] = await Promise.all([
      prisma.rating.findMany({
        where: { 
          receiverId: userId,
          isHidden: false,
        },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          giver: {
            select: {
              id: true,
              name: true,
              image: true,
              rating: true,
            },
          },
          swap: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      }),
      prisma.rating.count({ 
        where: { 
          receiverId: userId,
          isHidden: false,
        },
      }),
    ]);

    return {
      data: ratings,
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
   * Get ratings for a specific swap
   */
  async getSwapRatings(swapId: string, userId: string) {
    // Verify user has access to this swap
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You can only view ratings for your own swaps');
    }

    const ratings = await prisma.rating.findMany({
      where: { swapId },
      include: {
        giver: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    return ratings;
  }

  /**
   * Get rating by ID
   */
  async getRatingById(ratingId: string) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId },
      include: {
        giver: {
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
        swap: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!rating) {
      throw new NotFoundError('Rating not found');
    }

    return rating;
  }

  /**
   * Update a rating
   */
  async updateRating(ratingId: string, userId: string, updateData: any) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId },
    });

    if (!rating) {
      throw new NotFoundError('Rating not found');
    }

    if (rating.giverId !== userId) {
      throw new ForbiddenError('You can only update your own ratings');
    }

    // Validate stars if being updated
    if (updateData.stars && (updateData.stars < 1 || updateData.stars > 5)) {
      throw new BadRequestError('Stars must be between 1 and 5');
    }

    const updatedRating = await prisma.rating.update({
      where: { id: ratingId },
      data: {
        stars: updateData.stars,
        comment: updateData.comment,
        punctuality: updateData.punctuality,
        communication: updateData.communication,
        professionalism: updateData.professionalism,
        safety: updateData.safety,
      },
      include: {
        giver: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    // Update user's average rating if stars changed
    if (updateData.stars) {
      await this.updateUserRating(rating.receiverId);
    }

    logger.info(`Rating updated: ${ratingId} by user ${userId}`);

    return updatedRating;
  }

  /**
   * Delete a rating
   */
  async deleteRating(ratingId: string, userId: string) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId },
    });

    if (!rating) {
      throw new NotFoundError('Rating not found');
    }

    if (rating.giverId !== userId) {
      throw new ForbiddenError('You can only delete your own ratings');
    }

    const receiverId = rating.receiverId;

    await prisma.rating.delete({
      where: { id: ratingId },
    });

    // Recalculate user's rating after deletion
    await this.updateUserRating(receiverId);

    logger.info(`Rating deleted: ${ratingId} by user ${userId}`);
  }

  /**
   * Report a rating
   */
  async reportRating(ratingId: string, userId: string, reason: string) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId },
    });

    if (!rating) {
      throw new NotFoundError('Rating not found');
    }

    if (rating.giverId === userId) {
      throw new BadRequestError('You cannot report your own rating');
    }

    await prisma.rating.update({
      where: { id: ratingId },
      data: {
        isReported: true,
        reportReason: reason,
      },
    });

    // Create admin log for moderation
    await prisma.adminLog.create({
      data: {
        adminId: userId,
        action: 'CONTENT_MODERATED',
        targetType: 'Rating',
        targetId: ratingId,
        details: `Rating reported: ${reason}`,
      },
    });

    logger.warn(`Rating reported: ${ratingId} by user ${userId} - Reason: ${reason}`);
  }

  /**
   * Mark rating as helpful (future feature)
   */
  async markAsHelpful(ratingId: string, userId: string) {
    const rating = await prisma.rating.findUnique({
      where: { id: ratingId },
    });

    if (!rating) {
      throw new NotFoundError('Rating not found');
    }

    // This would require a separate table for helpful votes
    // For now, just log the action
    logger.info(`Rating ${ratingId} marked as helpful by user ${userId}`);
  }

  /**
   * Get pending ratings for user (swaps that need to be rated)
   */
  async getPendingRatings(userId: string) {
    // Find completed swaps where user hasn't given a rating yet
    const completedSwaps = await prisma.swap.findMany({
      where: {
        OR: [
          { initiatorId: userId },
          { receiverId: userId },
        ],
        status: 'COMPLETED',
      },
      include: {
        initiator: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        ratings: {
          where: {
            giverId: userId,
          },
        },
      },
    });

    // Filter swaps that don't have a rating from this user
    const pendingSwaps = completedSwaps.filter(swap => swap.ratings.length === 0);

    return pendingSwaps.map(swap => ({
      swapId: swap.id,
      otherUser: swap.initiatorId === userId ? swap.receiver : swap.initiator,
      completedAt: swap.completedAt,
    }));
  }

  /**
   * Get rating statistics for a user
   */
  async getRatingStats(userId: string) {
    const [total, breakdown, avg] = await Promise.all([
      prisma.rating.count({
        where: { receiverId: userId, isHidden: false },
      }),
      prisma.rating.groupBy({
        by: ['stars'],
        where: { receiverId: userId, isHidden: false },
        _count: {
          stars: true,
        },
      }),
      prisma.rating.aggregate({
        where: { receiverId: userId, isHidden: false },
        _avg: {
          stars: true,
          punctuality: true,
          communication: true,
          professionalism: true,
          safety: true,
        },
      }),
    ]);

    return {
      total,
      average: avg._avg.stars || 0,
      breakdown: breakdown.reduce((acc, item) => {
        acc[`${item.stars}_stars`] = item._count.stars;
        return acc;
      }, {} as Record<string, number>),
      categories: {
        punctuality: avg._avg.punctuality || 0,
        communication: avg._avg.communication || 0,
        professionalism: avg._avg.professionalism || 0,
        safety: avg._avg.safety || 0,
      },
    };
  }
}