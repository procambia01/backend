// src/services/matching.service.ts
import { prisma } from '@/config/database';
import { OfferStatus } from '@prisma/client';

export class MatchingService {
  /**
   * Find matching offers for a given offer
   */
  async findMatches(offerId: string, userId: string) {
    const offer = await prisma.swapOffer.findUnique({ where: { id: offerId } });
    if (!offer) throw new Error('Offer not found');

    const matches = await prisma.swapOffer.findMany({
      where: {
        status: OfferStatus.ACTIVE,
        userId: { not: userId },
        haveCurrency: offer.wantCurrency,
        wantCurrency: offer.haveCurrency,
        country: offer.country,
        NOT: { id: offerId },
      },
      include: {
        user: {
          select: {
            id: true, name: true, image: true,
            rating: true, totalSwaps: true,
            idVerified: true, trustScore: true,
          },
        },
      },
      take: 20,
    });

    // Score matches by rate proximity and trust
    return matches
      .map(m => ({
        ...m,
        score: this.scoreMatch(offer.exchangeRate, m.exchangeRate, m.user.trustScore),
      }))
      .sort((a, b) => b.score - a.score);
  }

  private scoreMatch(offerRate: number, matchRate: number, trustScore: number): number {
    const rateDiff = Math.abs(offerRate - matchRate) / offerRate;
    const rateScore  = Math.max(0, 1 - rateDiff * 10) * 60;
    const trustScore_ = (trustScore / 100) * 40;
    return rateScore + trustScore_;
  }

  /**
   * Auto-match offers after creation
   */
  async autoMatch(offerId: string, userId: string): Promise<number> {
    const matches = await this.findMatches(offerId, userId);
    if (matches.length > 0) {
      await prisma.swapOffer.update({
        where: { id: offerId },
        data: { matchCount: matches.length },
      });
    }
    return matches.length;
  }
}
