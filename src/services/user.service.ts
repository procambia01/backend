// src/services/user.service.ts
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/utils/error.util';
import { PaginationParams } from '@/utils/pagination.util';
import { cloudinaryService } from '@/config/cloudinary';
import { ActivityType, PremiumTier } from '@prisma/client';
import logger from '@/utils/logger.util';

export class UserService {
  /**
   * Get all users
   */
  async getAllUsers(pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          rating: true,
          totalSwaps: true,
          successfulSwaps: true,
          isPremium: true,
          emailVerified: true,
          idVerified: true,
          createdAt: true,
        },
      }),
      prisma.user.count(),
    ]);

    return {
      data: users,
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
   * Search users
   */
  async searchUsers(
    filters: {
      q?: string;
      country?: string;
      city?: string;
      verified?: boolean;
      minRating?: number;
    },
    pagination: PaginationParams
  ) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const where: any = {};

    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { email: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    if (filters.country) {
      where.country = filters.country;
    }

    if (filters.city) {
      where.city = filters.city;
    }

    if (filters.verified !== undefined) {
      where.emailVerified = filters.verified;
    }

    if (filters.minRating) {
      where.rating = { gte: filters.minRating };
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          rating: true,
          totalSwaps: true,
          successfulSwaps: true,
          country: true,
          city: true,
          isPremium: true,
          emailVerified: true,
          idVerified: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      data: users,
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
   * Get nearby users
   */
  async getNearbyUsers(latitude: number, longitude: number, radius: number = 10) {
    // Get all users with location
    const users = await prisma.user.findMany({
      where: {
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        name: true,
        image: true,
        rating: true,
        latitude: true,
        longitude: true,
        country: true,
        city: true,
      },
    });

    // Calculate distance and filter
    const nearbyUsers = users
      .map(user => {
        const distance = this.calculateDistance(
          latitude,
          longitude,
          user.latitude!,
          user.longitude!
        );
        return { ...user, distance };
      })
      .filter(user => user.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    return nearbyUsers;
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        bio: true,
        phone: true,
        country: true,
        city: true,
        state: true,
        rating: true,
        totalSwaps: true,
        successfulSwaps: true,
        confirmationRate: true,
        emailVerified: true,
        phoneVerified: true,
        idVerified: true,
        isPremium: true,
        premiumTier: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  /**
   * Update profile
   */
  async updateProfile(userId: string, updateData: any) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        name: updateData.name,
        bio: updateData.bio,
        phone: updateData.phone,
      },
    });

    logger.info(`Profile updated for user: ${userId}`);

    return user;
  }

  /**
   * Delete account
   */
  async deleteAccount(userId: string) {
    await prisma.user.delete({
      where: { id: userId },
    });

    logger.info(`Account deleted: ${userId}`);
  }

  /**
   * Upload profile image
   */
  async uploadProfileImage(userId: string, file: Express.Multer.File) {
    const result = await cloudinaryService.uploadProfileImage(file.buffer, userId);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { image: result.url },
    });

    logger.info(`Profile image uploaded for user: ${userId}`);

    return { url: result.url, user };
  }

  /**
   * Delete profile image
   */
  async deleteProfileImage(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });

    if (user?.image) {
      const publicId = cloudinaryService.extractPublicId(user.image);
      if (publicId) {
        await cloudinaryService.deleteFile(publicId);
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { image: null },
    });

    logger.info(`Profile image deleted for user: ${userId}`);
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId: string) {
    const [user, ratingsReceived, swaps] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          totalSwaps: true,
          successfulSwaps: true,
          failedSwaps: true,
          rating: true,
        },
      }),
      prisma.rating.count({
        where: { receiverId: userId },
      }),
      prisma.swap.count({
        where: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
        },
      }),
    ]);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return {
      totalSwaps: user.totalSwaps,
      successfulSwaps: user.successfulSwaps,
      failedSwaps: user.failedSwaps,
      rating: user.rating,
      ratingsReceived,
      swaps,
    };
  }

  /**
   * Get user ratings
   */
  async getUserRatings(userId: string, pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [ratings, total] = await Promise.all([
      prisma.rating.findMany({
        where: { receiverId: userId },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          giver: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      }),
      prisma.rating.count({ where: { receiverId: userId } }),
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
   * Get user offers
   */
  async getUserOffers(userId: string, pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [offers, total] = await Promise.all([
      prisma.swapOffer.findMany({
        where: { userId },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.swapOffer.count({ where: { userId } }),
    ]);

    return {
      data: offers,
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
   * Update preferences
   */
  async updatePreferences(userId: string, preferences: any) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        preferredCurrencies: preferences.preferredCurrencies,
        preferredMeetingPlaces: preferences.preferredMeetingPlaces,
        maxSwapAmount: preferences.maxSwapAmount,
        darkMode: preferences.darkMode,
        receiveEmails: preferences.receiveEmails,
        receiveSMS: preferences.receiveSMS,
        receivePush: preferences.receivePush,
      },
    });

    logger.info(`Preferences updated for user: ${userId}`);

    return user;
  }

  /**
   * Update location
   */
  async updateLocation(
    userId: string,
    location: {
      latitude: number;
      longitude: number;
      city: string;
      state?: string;
      country: string;
    }
  ) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        latitude: location.latitude,
        longitude: location.longitude,
        city: location.city,
        state: location.state,
        country: location.country,
        lastLocationUpdate: new Date(),
      },
    });

    logger.info(`Location updated for user: ${userId}`);

    return user;
  }

  /**
   * Verify phone
   */
  async verifyPhone(userId: string, phone: string, _code: string) {
    // TODO: Implement actual phone verification
    // For now, just mark as verified
    await prisma.user.update({
      where: { id: userId },
      data: {
        phone,
        phoneVerified: true,
      },
    });

    logger.info(`Phone verified for user: ${userId}`);
  }

  /**
   * Submit verification
   */
  async submitVerification(
    userId: string,
    file: Express.Multer.File,
    data: {
      documentType: string;
      documentNumber: string;
      country: string;
    }
  ) {
    const result = await cloudinaryService.uploadIdDocument(file.buffer, userId);

    await prisma.user.update({
      where: { id: userId },
      data: {
        idDocumentUrl: result.url,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId,
        action: ActivityType.VERIFICATION_SUBMITTED,
        description: 'Verification documents submitted',
        metadata: data,
      },
    });

    logger.info(`Verification submitted for user: ${userId}`);
  }

  /**
   * Upload verification selfie
   */
  async uploadVerificationSelfie(userId: string, file: Express.Multer.File) {
    const result = await cloudinaryService.uploadSelfie(file.buffer, userId);

    await prisma.user.update({
      where: { id: userId },
      data: {
        selfieUrl: result.url,
      },
    });

    logger.info(`Verification selfie uploaded for user: ${userId}`);
  }

  /**
   * Get verification status
   */
  async getVerificationStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        emailVerified: true,
        phoneVerified: true,
        idVerified: true,
        idDocumentUrl: true,
        selfieUrl: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  /**
   * Block user
   */
  async blockUser(userId: string, blockedId: string, reason?: string) {
    if (userId === blockedId) {
      throw new BadRequestError('You cannot block yourself');
    }

    await prisma.blockedUser.create({
      data: {
        blockerId: userId,
        blockedId,
        reason,
      },
    });

    logger.info(`User ${userId} blocked user ${blockedId}`);
  }

  /**
   * Unblock user
   */
  async unblockUser(userId: string, blockedId: string) {
    await prisma.blockedUser.deleteMany({
      where: {
        blockerId: userId,
        blockedId,
      },
    });

    logger.info(`User ${userId} unblocked user ${blockedId}`);
  }

  /**
   * Get blocked users
   */
  async getBlockedUsers(userId: string) {
    const blockedUsers = await prisma.blockedUser.findMany({
      where: { blockerId: userId },
      include: {
        blocked: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    return blockedUsers;
  }

  /**
   * Add favorite
   */
  async addFavorite(userId: string, favoriteId: string, notes?: string) {
    if (userId === favoriteId) {
      throw new BadRequestError('You cannot favorite yourself');
    }

    await prisma.favoriteUser.create({
      data: {
        userId,
        favoriteId,
        notes,
      },
    });

    logger.info(`User ${userId} added user ${favoriteId} to favorites`);
  }

  /**
   * Remove favorite
   */
  async removeFavorite(userId: string, favoriteId: string) {
    await prisma.favoriteUser.deleteMany({
      where: {
        userId,
        favoriteId,
      },
    });

    logger.info(`User ${userId} removed user ${favoriteId} from favorites`);
  }

  /**
   * Get favorites
   */
  async getFavorites(userId: string) {
    const favorites = await prisma.favoriteUser.findMany({
      where: { userId },
      include: {
        favorite: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
          },
        },
      },
    });

    return favorites;
  }

  /**
   * Subscribe to premium
   */
  async subscribePremium(userId: string, tier: string, duration: number) {
    const premiumExpiry = new Date();
    premiumExpiry.setMonth(premiumExpiry.getMonth() + duration);

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        isPremium: true,
        premiumTier: tier as PremiumTier,
        premiumExpiry,
      },
    });

    logger.info(`Premium subscription activated for user: ${userId}`);

    return user;
  }

  /**
   * Cancel premium
   */
  async cancelPremium(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        isPremium: false,
        premiumTier: null,
        premiumExpiry: null,
      },
    });

    logger.info(`Premium subscription cancelled for user: ${userId}`);
  }

  /**
   * Get premium status
   */
  async getPremiumStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isPremium: true,
        premiumTier: true,
        premiumExpiry: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  /**
   * Get activity log
   */
  async getActivityLog(userId: string, pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [activities, total] = await Promise.all([
      prisma.activityLog.findMany({
        where: { userId },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.activityLog.count({ where: { userId } }),
    ]);

    return {
      data: activities,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
        hasMore: page < Math.ceil(total / perPage),
      },
    };
  }
}