// src/services/user.service.ts
import Stripe from 'stripe';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/utils/error.util';
import { PaginationParams } from '@/utils/pagination.util';
import { cloudinaryService } from '@/config/cloudinary';
import { ActivityType, PremiumTier, TransactionType, TransactionStatus, NotificationType } from '@prisma/client';
import { MONETIZATION } from '@/config/monetization';
import config from '@/config/env';
import { generateApiKey } from '@/utils/apiKey.util';
import logger from '@/utils/logger.util';

const stripe = new Stripe(config.payment.stripe.secretKey ?? '', {
  apiVersion: '2025-02-24.acacia',
});

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
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');
    if (!user.verificationFeePaid) {
      throw new BadRequestError(
        'Please complete the one-time verification fee before submitting documents.'
      );
    }

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

  // ────────────────────────────────────────────────────────
  // Paid verification (KYC)
  // ────────────────────────────────────────────────────────

  /** Create a Stripe Checkout session for the one-time verification fee. */
  async createVerificationCheckoutSession(userId: string, origin: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');
    if (user.verificationFeePaid) {
      throw new BadRequestError('Verification fee already paid');
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: MONETIZATION.verification.currency,
            unit_amount: MONETIZATION.verification.amountCents,
            product_data: {
              name: 'ID Verification',
              description: 'One-time fee to submit ID verification and earn the Verified Trader badge.',
            },
          },
          quantity: 1,
        },
      ],
      metadata: { type: 'VERIFICATION_FEE', userId },
      success_url: `${origin}/dashboard/profile/verification?fee=paid`,
      cancel_url: `${origin}/dashboard/profile/verification?fee=cancelled`,
    });

    return session;
  }

  /** Stripe webhook handler for checkout.session.completed, type=VERIFICATION_FEE */
  async handleVerificationCheckoutCompleted(session: Stripe.Checkout.Session) {
    const { userId } = session.metadata ?? {};
    if (!userId) return;

    const amount = (session.amount_total ?? 0) / 100;
    const currency = (session.currency ?? 'usd').toUpperCase();

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { verificationFeePaid: true },
      }),
      prisma.transaction.create({
        data: {
          userId,
          type: TransactionType.VERIFICATION_FEE,
          amount,
          currency,
          description: 'ID verification fee',
          status: TransactionStatus.COMPLETED,
          paymentGateway: 'stripe',
          gatewayTransactionId: session.id,
          completedAt: new Date(),
        },
      }),
    ]);

    logger.info(`Verification fee paid — user ${userId}`);
  }

  // ────────────────────────────────────────────────────────
  // B2B / partner API access
  // ────────────────────────────────────────────────────────

  /** Create a Stripe Checkout session (subscription) for a partner plan. */
  async createPartnerCheckoutSession(userId: string, planId: string, origin: string) {
    const plan = MONETIZATION.partner.plans.find((p) => p.id === planId);
    if (!plan) throw new BadRequestError('Invalid partner plan');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');

    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId },
      });
      stripeCustomerId = customer.id;
      await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId } });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: MONETIZATION.partner.currency,
            unit_amount: plan.amountCents,
            recurring: { interval: plan.interval },
            product_data: { name: plan.name },
          },
          quantity: 1,
        },
      ],
      metadata: { type: 'PARTNER_ACCESS', userId, planId, rateLimit: String(plan.rateLimitPerMinute) },
      success_url: `${origin}/dashboard/partner?checkout=success`,
      cancel_url: `${origin}/dashboard/partner?checkout=cancelled`,
    });

    return session;
  }

  /**
   * Stripe webhook handler for checkout.session.completed, type=PARTNER_ACCESS.
   * Flags the account as a business partner and issues their first API key.
   */
  async handlePartnerCheckoutCompleted(session: Stripe.Checkout.Session) {
    const { userId, rateLimit } = session.metadata ?? {};
    if (!userId) return;

    await prisma.user.update({
      where: { id: userId },
      data: { isBusinessPartner: true },
    });

    const { rawKey, keyPrefix, keyHash } = generateApiKey();
    await prisma.apiKey.create({
      data: {
        userId,
        name: 'Default key',
        keyPrefix,
        keyHash,
        scopes: ['rates:read', 'offers:read'],
        rateLimitPerMinute: Number(rateLimit) || 60,
      },
    });

    await prisma.transaction.create({
      data: {
        userId,
        type: TransactionType.BUSINESS_API_ACCESS,
        amount: (session.amount_total ?? 0) / 100,
        currency: (session.currency ?? 'usd').toUpperCase(),
        description: 'Partner API access subscription',
        status: TransactionStatus.COMPLETED,
        paymentGateway: 'stripe',
        gatewayTransactionId: session.id,
        completedAt: new Date(),
      },
    });

    // The raw key is only ever available at issuance time — deliver it
    // via a one-time notification link the partner dashboard reads once.
    await prisma.notification.create({
      data: {
        userId,
        type: NotificationType.SYSTEM_ALERT,
        title: 'Your API key is ready',
        message: `Key: ${rawKey} — save this now, it won't be shown again. Manage keys from your partner dashboard.`,
        link: '/dashboard/partner',
      },
    });

    logger.info(`Partner access activated for user ${userId}`);
  }

  /** Issue an additional API key for an existing partner. */
  async createApiKey(userId: string, name: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.isBusinessPartner) {
      throw new BadRequestError('Partner API access required to create keys');
    }

    const { rawKey, keyPrefix, keyHash } = generateApiKey();
    const key = await prisma.apiKey.create({
      data: { userId, name, keyPrefix, keyHash },
    });

    // rawKey is returned once, here, and never again.
    return { ...key, rawKey };
  }

  async listApiKeys(userId: string) {
    return prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        isActive: true,
        rateLimitPerMinute: true,
        requestCount: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeApiKey(userId: string, keyId: string) {
    const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key || key.userId !== userId) throw new NotFoundError('API key not found');

    return prisma.apiKey.update({
      where: { id: keyId },
      data: { isActive: false, revokedAt: new Date() },
    });
  }
}