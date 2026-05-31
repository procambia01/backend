// src/services/offer.service.ts
import { prisma } from '@/config/database';
import { NotFoundError, ForbiddenError, BadRequestError } from '@/utils/error.util';
import { PaginationParams } from '@/utils/pagination.util';
import { OfferStatus } from '@prisma/client';
import DistanceUtil from '@/utils/distance.util';
import { ExchangeRateService } from './exchangeRate.service';
import logger from '@/utils/logger.util';

// Type for offers with distance
type OfferWithDistance = any & { distance: number };

export class OfferService {
  private exchangeRateService: ExchangeRateService;

  constructor() {
    this.exchangeRateService = new ExchangeRateService();
  }

  /**
   * Get all offers
   */
  async getAllOffers(filters: any, pagination: PaginationParams) {
    const { page, perPage, sortBy, sortOrder } = pagination;
    const skip = (page - 1) * perPage;

    const where: any = {
      status: { in: [OfferStatus.ACTIVE, OfferStatus.MATCHED] },
    };

    if (filters.haveCurrency) where.haveCurrency = filters.haveCurrency;
    if (filters.wantCurrency) where.wantCurrency = filters.wantCurrency;
    if (filters.country) where.country = filters.country;
    if (filters.city) where.city = filters.city;

    const [offers, total] = await Promise.all([
      prisma.swapOffer.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { [sortBy || 'createdAt']: sortOrder || 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              rating: true,
              totalSwaps: true,
              idVerified: true,
            },
          },
        },
      }),
      prisma.swapOffer.count({ where }),
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
   * Search offers
   */
  async searchOffers(searchParams: any) {
    const {
      haveCurrency,
      wantCurrency,
      minAmount,
      maxAmount,
      country,
      city,
      latitude,
      longitude,
      radius,
      verifiedOnly,
      minTrustScore,
      availableNow,
      sortBy,
      sortOrder,
      page,
      limit,
    } = searchParams;

    const skip = (page - 1) * limit;
    const where: any = { status: OfferStatus.ACTIVE };

    if (haveCurrency) where.haveCurrency = haveCurrency;
    if (wantCurrency) where.wantCurrency = wantCurrency;
    if (minAmount) where.haveAmount = { gte: minAmount };
    if (maxAmount) where.haveAmount = { ...where.haveAmount, lte: maxAmount };
    if (country) where.country = country;
    if (city) where.city = city;
    if (verifiedOnly) where.requiresVerifiedUsers = true;
    if (minTrustScore) where.minTrustScore = { gte: minTrustScore };
    if (availableNow) {
      where.availableFrom = { lte: new Date() };
      where.availableUntil = { gte: new Date() };
    }

    // Location filtering
    if (latitude && longitude && radius) {
      const bounds = DistanceUtil.getBoundingBox({ latitude, longitude }, radius);
      where.latitude = { gte: bounds.minLat, lte: bounds.maxLat };
      where.longitude = { gte: bounds.minLng, lte: bounds.maxLng };
    }

    const [offers, total] = await Promise.all([
      prisma.swapOffer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: sortOrder || 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              rating: true,
              idVerified: true,
            },
          },
        },
      }),
      prisma.swapOffer.count({ where }),
    ]);

    // Calculate distance if location provided
    let offersWithDistance: OfferWithDistance[] = offers;
    if (latitude && longitude) {
      offersWithDistance = offers.map((offer) => ({
        ...offer,
        distance: DistanceUtil.calculateDistanceInKm(
          { latitude, longitude },
          { latitude: offer.latitude, longitude: offer.longitude }
        ),
      }));

      if (sortBy === 'distance') {
        offersWithDistance.sort((a, b) =>
          sortOrder === 'asc' ? a.distance - b.distance : b.distance - a.distance
        );
      }
    }

    return {
      data: offersWithDistance,
      meta: {
        page,
        perPage: limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page < Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get nearby offers
   */
  async getNearbyOffers(
    latitude: number,
    longitude: number,
    radiusKm: number,
    haveCurrency?: string,
    wantCurrency?: string
  ) {
    const bounds = DistanceUtil.getBoundingBox({ latitude, longitude }, radiusKm);

    const where: any = {
      status: OfferStatus.ACTIVE,
      latitude: { gte: bounds.minLat, lte: bounds.maxLat },
      longitude: { gte: bounds.minLng, lte: bounds.maxLng },
    };

    if (haveCurrency) where.haveCurrency = haveCurrency;
    if (wantCurrency) where.wantCurrency = wantCurrency;

    const offers = await prisma.swapOffer.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
            idVerified: true,
          },
        },
      },
    });

    // Filter by actual distance and add distance field
    const nearbyOffers = offers
      .filter((offer) =>
        DistanceUtil.isWithinRadius(
          { latitude, longitude },
          { latitude: offer.latitude, longitude: offer.longitude },
          radiusKm
        )
      )
      .map((offer) => ({
        ...offer,
        distance: DistanceUtil.calculateDistanceInKm(
          { latitude, longitude },
          { latitude: offer.latitude, longitude: offer.longitude }
        ),
      }))
      .sort((a, b) => a.distance - b.distance);

    return nearbyOffers;
  }

  /**
   * Get featured offers
   */
  async getFeaturedOffers(pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [offers, total] = await Promise.all([
      prisma.swapOffer.findMany({
        where: {
          status: OfferStatus.ACTIVE,
          visibility: 'PUBLIC',
        },
        skip,
        take: perPage,
        orderBy: { viewCount: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              rating: true,
              idVerified: true,
            },
          },
        },
      }),
      prisma.swapOffer.count({
        where: { status: OfferStatus.ACTIVE, visibility: 'PUBLIC' },
      }),
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
   * Get trending offers
   */
  async getTrendingOffers(limit: number) {
    const offers = await prisma.swapOffer.findMany({
      where: {
        status: OfferStatus.ACTIVE,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      take: limit,
      orderBy: [{ viewCount: 'desc' }, { matchCount: 'desc' }],
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
          },
        },
      },
    });

    return offers;
  }

  /**
   * Get matching offers for user
   */
  async getMatchingOffers(userId: string, pagination: PaginationParams) {
    const userOffers = await prisma.swapOffer.findMany({
      where: { userId, status: OfferStatus.ACTIVE },
      select: { haveCurrency: true, wantCurrency: true },
    });

    if (userOffers.length === 0) {
      return {
        data: [],
        meta: { page: 1, perPage: 10, total: 0, totalPages: 0, hasMore: false },
      };
    }

    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const matches = userOffers.flatMap((offer) => [
      { haveCurrency: offer.wantCurrency, wantCurrency: offer.haveCurrency },
    ]);

    const where: any = {
      status: OfferStatus.ACTIVE,
      userId: { not: userId },
      OR: matches,
    };

    const [offers, total] = await Promise.all([
      prisma.swapOffer.findMany({
        where,
        skip,
        take: perPage,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              rating: true,
            },
          },
        },
      }),
      prisma.swapOffer.count({ where }),
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
   * Get offers belonging to a specific user (for /my endpoint)
   */
  async getUserOffers(userId: string, filters: any, pagination: any) {
    const { page, perPage, sortBy, sortOrder } = pagination;
    const skip = (page - 1) * perPage;

    const where: any = { userId };

    // Optional status filter from query param
    if (filters.status) {
      const statuses = (filters.status as string)
        .split(',')
        .map((s: string) => s.trim().toUpperCase());
      where.status = { in: statuses };
    }

    const [offers, total] = await Promise.all([
      prisma.swapOffer.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { [sortBy || 'createdAt']: sortOrder || 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              rating: true,
              totalSwaps: true,
              idVerified: true,
            },
          },
        },
      }),
      prisma.swapOffer.count({ where }),
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
   * Create offer
   */
  async createOffer(userId: string, offerData: any) {
    if (!offerData.exchangeRate) {
      offerData.exchangeRate = await this.exchangeRateService.getRate(
        offerData.haveCurrency,
        offerData.wantCurrency
      );
    }

    if (!offerData.wantAmount) {
      offerData.wantAmount = offerData.haveAmount * offerData.exchangeRate;
    }

    const offer = await prisma.swapOffer.create({
      data: {
        ...offerData,
        userId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
          },
        },
      },
    });

    await prisma.activityLog.create({
      data: {
        userId,
        action: 'OFFER_CREATED',
        description: `Created offer: ${offerData.haveAmount} ${offerData.haveCurrency} to ${offerData.wantAmount} ${offerData.wantCurrency}`,
      },
    });

    logger.info(`Offer created: ${offer.id} by user ${userId}`);

    return offer;
  }

  /**
   * Get offer by ID
   */
  async getOfferById(offerId: string) {
    const offer = await prisma.swapOffer.findUnique({
      where: { id: offerId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
            totalSwaps: true,
            idVerified: true,
          },
        },
      },
    });

    if (!offer) {
      throw new NotFoundError('Offer not found');
    }

    return offer;
  }

  /**
   * Update offer
   */
  async updateOffer(offerId: string, userId: string, updateData: any) {
    const offer = await prisma.swapOffer.findUnique({
      where: { id: offerId },
      select: { userId: true },
    });

    if (!offer) {
      throw new NotFoundError('Offer not found');
    }

    if (offer.userId !== userId) {
      throw new ForbiddenError('You can only update your own offers');
    }

    const updatedOffer = await prisma.swapOffer.update({
      where: { id: offerId },
      data: updateData,
    });

    await prisma.activityLog.create({
      data: {
        userId,
        action: 'OFFER_UPDATED',
        description: `Updated offer ${offerId}`,
      },
    });

    logger.info(`Offer updated: ${offerId} by user ${userId}`);

    return updatedOffer;
  }

  /**
   * Delete offer
   */
  async deleteOffer(offerId: string, userId: string) {
    const offer = await prisma.swapOffer.findUnique({
      where: { id: offerId },
      select: { userId: true },
    });

    if (!offer) {
      throw new NotFoundError('Offer not found');
    }

    if (offer.userId !== userId) {
      throw new ForbiddenError('You can only delete your own offers');
    }

    await prisma.swapOffer.delete({
      where: { id: offerId },
    });

    await prisma.activityLog.create({
      data: {
        userId,
        action: 'OFFER_DELETED',
        description: `Deleted offer ${offerId}`,
      },
    });

    logger.info(`Offer deleted: ${offerId} by user ${userId}`);
  }

  /**
   * Pause offer
   */
  async pauseOffer(offerId: string, userId: string) {
    return this.updateOffer(offerId, userId, { status: OfferStatus.PAUSED });
  }

  /**
   * Resume offer
   */
  async resumeOffer(offerId: string, userId: string) {
    return this.updateOffer(offerId, userId, { status: OfferStatus.ACTIVE });
  }

  /**
   * Boost offer
   */
  async boostOffer(offerId: string, userId: string, duration: number) {
    return this.updateOffer(offerId, userId, {
      // Add boostedUntil field to your schema if needed
      updatedAt: new Date(),
    });
  }

  /**
   * Feature offer
   */
  async featureOffer(offerId: string, userId: string, duration: number) {
    return this.updateOffer(offerId, userId, {
      // Add featuredUntil field to your schema if needed
      updatedAt: new Date(),
    });
  }

  /**
   * Get offer matches
   */
  async getOfferMatches(offerId: string, userId: string) {
    const offer = await this.getOfferById(offerId);

    if (offer.userId !== userId) {
      throw new ForbiddenError('You can only view matches for your own offers');
    }

    const matches = await prisma.swapOffer.findMany({
      where: {
        status: OfferStatus.ACTIVE,
        haveCurrency: offer.wantCurrency,
        wantCurrency: offer.haveCurrency,
        userId: { not: userId },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
          },
        },
      },
    });

    return matches;
  }

  /**
   * Increment view count
   */
  async incrementViewCount(offerId: string) {
    await prisma.swapOffer.update({
      where: { id: offerId },
      data: { viewCount: { increment: 1 } },
    });
  }

  /**
   * Get offer analytics
   */
  async getOfferAnalytics(offerId: string, userId: string) {
    const offer = await prisma.swapOffer.findUnique({
      where: { id: offerId },
      select: {
        userId: true,
        viewCount: true,
        matchCount: true,
        createdAt: true,
      },
    });

    if (!offer) {
      throw new NotFoundError('Offer not found');
    }

    if (offer.userId !== userId) {
      throw new ForbiddenError('You can only view analytics for your own offers');
    }

    const swapsCount = await prisma.swap.count({
      where: { offerId },
    });

    return {
      views: offer.viewCount,
      matches: offer.matchCount,
      swaps: swapsCount,
      daysActive: Math.floor((Date.now() - offer.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    };
  }

  /**
   * Report offer
   */
  async reportOffer(offerId: string, userId: string, reason: string, description: string) {
    // Log as admin action instead of using a Report model
    await prisma.adminLog.create({
      data: {
        adminId: userId,
        action: 'CONTENT_MODERATED',
        targetType: 'SwapOffer',
        targetId: offerId,
        details: `Offer reported: ${reason} - ${description}`,
      },
    });

    logger.warn(`Offer reported: ${offerId} by user ${userId} - Reason: ${reason}`);
  }
}
