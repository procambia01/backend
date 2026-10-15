import type { AdDto } from '@/contracts';
import { toOwnerAdDto } from '@/presenters/billing.presenter';
import type { AdCampaign, AdPlacement } from '@prisma/client';
import { prisma } from '@/config/database';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/utils/error.util';
import { auditService } from './audit.service';

export interface AdInput {
  type: 'SPONSORED_OFFER' | 'SPONSORED_BUSINESS' | 'FEATURED_PARTNER';
  placement: AdPlacement;
  title: string;
  body?: string;
  imageUrl?: string;
  targetUrl?: string;
  offerId?: string;
  currencies: string[];
  countries: string[];
  cities: string[];
}

export const toAdDto = toOwnerAdDto;

/** Public shape of a served ad. Always labelled so clients can show a "Sponsored" badge. */
export const toServedAd = (a: AdCampaign): AdDto => ({
  id: a.id, type: a.type, placement: a.placement, title: a.title, body: a.body, imageUrl: a.imageUrl, targetUrl: a.targetUrl, offerId: a.offerId, sponsored: true,
});

export class AdService {
  private async validate(userId: string, input: AdInput) {
    if (input.targetUrl && !/^https:\/\//i.test(input.targetUrl)) throw new BadRequestError('targetUrl must use https');
    if (input.imageUrl && !/^https:\/\//i.test(input.imageUrl)) throw new BadRequestError('imageUrl must use https');
    if (input.type === 'SPONSORED_OFFER') {
      if (!input.offerId) throw new BadRequestError('offerId is required for a sponsored offer');
      const o = await prisma.swapOffer.findFirst({ where: { id: input.offerId, userId } });
      if (!o) throw new NotFoundError('Offer not found');
    }
    if (input.type === 'SPONSORED_BUSINESS' || input.type === 'FEATURED_PARTNER') {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { businessVerified: true } });
      if (!u.businessVerified) throw new ForbiddenError('A verified business is required for this ad type');
    }
  }

  async create(userId: string, input: AdInput) {
    await this.validate(userId, input);
    const c = await prisma.adCampaign.create({ data: { advertiserId: userId, ...input, status: 'DRAFT' } });
    return toAdDto(c);
  }

  async update(userId: string, id: string, input: AdInput) {
    await this.validate(userId, input);
    const r = await prisma.adCampaign.updateMany({ where: { id, advertiserId: userId, status: { in: ['DRAFT', 'REJECTED'] } }, data: { ...input, status: 'DRAFT', reviewNote: null } });
    if (r.count !== 1) throw new ConflictError('Only draft or rejected campaigns can be edited');
    return toAdDto(await prisma.adCampaign.findUniqueOrThrow({ where: { id } }));
  }

  async mine(userId: string) {
    return (await prisma.adCampaign.findMany({ where: { advertiserId: userId }, orderBy: { createdAt: 'desc' }, take: 100 })).map(toAdDto);
  }

  /** Payment succeeded (verified webhook) → campaign goes to moderation. Idempotent. */
  async onPaid(campaignId: string, paymentId: string): Promise<void> {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    await prisma.adCampaign.updateMany({
      where: { id: campaignId, status: { in: ['DRAFT', 'PENDING_PAYMENT'] } },
      data: { status: 'PENDING_REVIEW', paymentId, productCode: payment?.productCode },
    });
  }

  // ───────────── admin moderation ─────────────

  async reviewQueue(page: number, perPage: number) {
    const where = { status: 'PENDING_REVIEW' as const };
    const [items, total] = await Promise.all([
      prisma.adCampaign.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (page - 1) * perPage, take: perPage }),
      prisma.adCampaign.count({ where }),
    ]);
    return { items: items.map(toAdDto), total };
  }

  async review(adminId: string, id: string, decision: 'APPROVE' | 'REJECT', note?: string) {
    const c = await prisma.adCampaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundError('Campaign not found');
    if (decision === 'REJECT' && !note) throw new BadRequestError('A reason is required to reject');
    const now = new Date();
    let data;
    if (decision === 'APPROVE') {
      const product = c.productCode ? await prisma.serviceProduct.findUnique({ where: { code: c.productCode } }) : null;
      const hours = product?.durationHours ?? 24 * 7;
      data = { status: 'ACTIVE' as const, startsAt: now, endsAt: new Date(now.getTime() + hours * 3600_000), reviewedBy: adminId, reviewedAt: now, reviewNote: note ?? null };
    } else {
      data = { status: 'REJECTED' as const, reviewedBy: adminId, reviewedAt: now, reviewNote: note ?? null };
    }
    const r = await prisma.adCampaign.updateMany({ where: { id, status: 'PENDING_REVIEW' }, data });
    if (r.count !== 1) throw new ConflictError('Campaign is not pending review');
    await auditService.record({ actorId: adminId, action: `ad.${decision.toLowerCase()}`, targetType: 'AdCampaign', targetId: id, before: { status: c.status }, after: { status: data.status }, reason: note });
  }

  async setPaused(adminId: string, id: string, paused: boolean) {
    const r = await prisma.adCampaign.updateMany({ where: paused ? { id, status: 'ACTIVE' } : { id, status: 'PAUSED' }, data: { status: paused ? 'PAUSED' : 'ACTIVE' } });
    if (r.count !== 1) throw new ConflictError('Campaign state does not allow this');
    await auditService.record({ actorId: adminId, action: paused ? 'ad.pause' : 'ad.resume', targetType: 'AdCampaign', targetId: id });
  }

  // ───────────── serving ─────────────

  async serve(placement: AdPlacement, ctx: { currency?: string; country?: string; city?: string }, limit = 3) {
    const now = new Date();
    const rows = await prisma.adCampaign.findMany({ where: { status: 'ACTIVE', placement, startsAt: { lte: now }, endsAt: { gt: now } }, take: 50 });
    const match = rows.filter(
      (a) =>
        (!a.currencies.length || !ctx.currency || a.currencies.includes(ctx.currency)) &&
        (!a.countries.length || !ctx.country || a.countries.includes(ctx.country)) &&
        (!a.cities.length || !ctx.city || a.cities.some((c) => c.toLowerCase() === ctx.city!.toLowerCase()))
    );
    // Fair rotation: least-shown first.
    match.sort((a, b) => a.impressions - b.impressions);
    const chosen = match.slice(0, limit);
    if (chosen.length) await prisma.adCampaign.updateMany({ where: { id: { in: chosen.map((c) => c.id) } }, data: { impressions: { increment: 1 } } });
    return chosen.map(toServedAd);
  }

  async click(id: string) {
    await prisma.adCampaign.updateMany({ where: { id, status: 'ACTIVE' }, data: { clicks: { increment: 1 } } });
  }

  async endElapsed(now = new Date()): Promise<number> {
    const r = await prisma.adCampaign.updateMany({ where: { status: 'ACTIVE', endsAt: { lte: now } }, data: { status: 'ENDED' } });
    return r.count;
  }
}

export const adService = new AdService();
