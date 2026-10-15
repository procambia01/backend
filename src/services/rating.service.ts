import { prisma } from '@/config/database';
import { toPublicUser } from '@/presenters/user.presenter';
import { ConflictError, ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from '@/utils/error.util';
import { cleanText } from './message.service';
import { notificationService } from './notification.service';

export interface RateInput {
  stars: number;
  comment?: string;
  punctuality?: number;
  communication?: number;
  professionalism?: number;
  safety?: number;
}

const inRange = (n?: number) => n === undefined || (Number.isInteger(n) && n >= 1 && n <= 5);

export class RatingService {
  async rate(giverId: string, swapId: string, input: RateInput) {
    if (![input.stars, input.punctuality, input.communication, input.professionalism, input.safety].every(inRange)) throw new ValidationError('Ratings must be whole numbers from 1 to 5');
    const swap = await prisma.swap.findUnique({ where: { id: swapId } });
    if (!swap || (swap.initiatorId !== giverId && swap.receiverId !== giverId)) throw new NotFoundError('Swap not found');
    if (swap.status !== 'COMPLETED') throw new InvalidStateError('You can rate a swap once it is completed');
    const receiverId = swap.initiatorId === giverId ? swap.receiverId : swap.initiatorId;
    try {
      const r = await prisma.rating.create({
        data: { swapId, giverId, receiverId, stars: input.stars, comment: input.comment ? cleanText(input.comment).slice(0, 500) : undefined, punctuality: input.punctuality, communication: input.communication, professionalism: input.professionalism, safety: input.safety },
      });
      await this.recomputeTrust(receiverId);
      const giver = await prisma.user.findUnique({ where: { id: giverId }, select: { name: true } });
      await notificationService.notify({ userId: receiverId, type: 'RATING_RECEIVED', entityId: swapId, params: { name: giver?.name.split(' ')[0] ?? '' }, dedupeKey: `rating:${r.id}` });
      return r;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictError('You have already rated this swap');
      throw e;
    }
  }

  async forUser(userId: string, page: number, perPage: number) {
    const where = { receiverId: userId, isHidden: false };
    const [rows, total] = await Promise.all([
      prisma.rating.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage, include: { giver: true } }),
      prisma.rating.count({ where }),
    ]);
    return {
      total,
      items: rows.map((r) => ({ id: r.id, stars: r.stars, comment: r.comment, punctuality: r.punctuality, communication: r.communication, professionalism: r.professionalism, safety: r.safety, createdAt: r.createdAt.toISOString(), giver: toPublicUser(r.giver) })),
    };
  }

  async report(userId: string, ratingId: string, reason: string) {
    const r = await prisma.rating.findUnique({ where: { id: ratingId } });
    if (!r) throw new NotFoundError('Rating not found');
    if (r.receiverId !== userId) throw new ForbiddenError('Only the rated user can report a rating');
    await prisma.rating.update({ where: { id: ratingId }, data: { isReported: true, reportReason: cleanText(reason).slice(0, 500) } });
  }

  async hide(ratingId: string, hidden: boolean) {
    const r = await prisma.rating.update({ where: { id: ratingId }, data: { isHidden: hidden } });
    await this.recomputeTrust(r.receiverId);
  }

  /**
   * Trust score (0–100). Transparent weights:
   *   ratings 40 · reliability 25 · experience 10 · verification 25 · − disputes up to 15
   */
  async recomputeTrust(userId: string): Promise<void> {
    const [user, agg] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.rating.aggregate({ where: { receiverId: userId, isHidden: false }, _avg: { stars: true }, _count: true }),
    ]);
    if (!user) return;
    const avg = agg._avg.stars ?? 0;
    const n = agg._count;
    // Few ratings pull toward neutral (3.5) so one 5★ cannot max the score.
    const shrunk = (avg * n + 3.5 * 3) / (n + 3);
    const ratingPts = n === 0 ? 20 : 40 * ((shrunk - 1) / 4);

    const attempts = user.successfulSwaps + user.cancelledSwaps + user.disputedSwaps;
    const reliability = attempts === 0 ? 0.5 : user.successfulSwaps / attempts;
    const reliabilityPts = 25 * reliability;
    const experiencePts = 10 * Math.min(user.successfulSwaps, 20) / 20;
    const verified = user.idVerified && user.verificationStatus === 'VERIFIED';
    const verificationPts = (verified ? 15 : 0) + (user.phoneVerified ? 5 : 0) + (user.emailVerified ? 3 : 0) + (user.businessVerified ? 2 : 0);
    const disputeRate = user.totalSwaps > 0 ? user.disputedSwaps / user.totalSwaps : 0;
    const disputePenalty = 15 * Math.min(1, disputeRate * 4);
    const trust = Math.max(0, Math.min(100, Math.round(ratingPts + reliabilityPts + experiencePts + verificationPts - disputePenalty)));
    await prisma.user.update({ where: { id: userId }, data: { trustScore: trust, rating: Math.round(avg * 100) / 100, confirmationRate: Math.round(reliability * 100) } });
  }
}

export const ratingService = new RatingService();
