import type { LedgerEntryType, Payment, ProductKind } from '@prisma/client';
import { prisma, Db } from '@/config/database';
import { BadRequestError } from '@/utils/error.util';
import { auditService } from './audit.service';

export const LEDGER_TYPE_BY_KIND: Record<ProductKind, LedgerEntryType> = {
  PREMIUM_PLAN: 'PREMIUM_SUBSCRIPTION',
  BUSINESS_PLAN: 'BUSINESS_SUBSCRIPTION',
  API_PLAN: 'API_SUBSCRIPTION',
  BOOST: 'BOOST_PURCHASE',
  FEATURED: 'FEATURED_PURCHASE',
  VERIFICATION: 'VERIFICATION_FEE',
  ADVERTISING: 'AD_PURCHASE',
};

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}

/**
 * CashMouver's own revenue ledger. Append-only: there is no update or delete
 * anywhere in the codebase (enforced by a source-scan test). Corrections are
 * new compensating entries that reference the original. This is NOT a user
 * balance — users have no balance of any kind.
 */
export class LedgerService {
  /** Idempotent on `reference`: a duplicate webhook can never double-book revenue. */
  private async append(data: Parameters<Db['ledgerEntry']['create']>[0]['data'], db: Db = prisma) {
    try {
      return await db.ledgerEntry.create({ data });
    } catch (error) {
      if (isUniqueViolation(error)) return db.ledgerEntry.findUniqueOrThrow({ where: { reference: data.reference } });
      throw error;
    }
  }

  recordSale(payment: Pick<Payment, 'id' | 'kind' | 'userId' | 'amountMinor' | 'currency' | 'productCode'>, db: Db = prisma) {
    return this.append(
      {
        entryType: LEDGER_TYPE_BY_KIND[payment.kind],
        direction: 'CREDIT',
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        paymentId: payment.id,
        userId: payment.userId,
        reference: `payment:${payment.id}:sale`,
        description: payment.productCode,
      },
      db
    );
  }

  recordRefund(payment: Pick<Payment, 'id' | 'userId' | 'currency'>, stripeRefundId: string, amountMinor: number, db: Db = prisma) {
    return this.append(
      {
        entryType: 'REFUND',
        direction: 'DEBIT',
        amountMinor,
        currency: payment.currency,
        paymentId: payment.id,
        userId: payment.userId,
        reference: `refund:${stripeRefundId}`,
        description: 'Refund of a CashMouver service payment',
      },
      db
    );
  }

  /** Manual correction by an admin: always a NEW entry, always audited, never an edit. */
  async adjust(adminId: string, input: { paymentId?: string; direction: 'CREDIT' | 'DEBIT'; amountMinor: number; currency: string; reason: string; reversesId?: string }) {
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new BadRequestError('amountMinor must be a positive integer');
    if (input.reason.trim().length < 5) throw new BadRequestError('A reason is required');
    const reference = `adjustment:${input.reversesId ?? 'manual'}:${Date.now()}:${adminId}`;
    const entry = await this.append({
      entryType: 'ADJUSTMENT',
      direction: input.direction,
      amountMinor: input.amountMinor,
      currency: input.currency.toUpperCase(),
      paymentId: input.paymentId,
      reversesId: input.reversesId,
      reference,
      description: input.reason,
      createdBy: adminId,
    });
    await auditService.record({ actorId: adminId, action: 'ledger.adjustment', targetType: 'LedgerEntry', targetId: entry.id, after: entry, reason: input.reason });
    return entry;
  }

  /** Net revenue per currency and entry type for a date range (CREDIT − DEBIT). */
  async summary(from: Date, to: Date) {
    const rows = await prisma.ledgerEntry.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { entryType: true, direction: true, amountMinor: true, currency: true } });
    const out = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.currency}|${r.entryType}`;
      out.set(k, (out.get(k) ?? 0) + (r.direction === 'CREDIT' ? r.amountMinor : -r.amountMinor));
    }
    return [...out.entries()].map(([k, netMinor]) => {
      const [currency, entryType] = k.split('|');
      return { currency, entryType, netMinor };
    });
  }

  async list(page: number, perPage: number, filter: { entryType?: LedgerEntryType; currency?: string } = {}) {
    const where = { ...(filter.entryType ? { entryType: filter.entryType } : {}), ...(filter.currency ? { currency: filter.currency } : {}) };
    const [items, total] = await Promise.all([
      prisma.ledgerEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      prisma.ledgerEntry.count({ where }),
    ]);
    return { items, total };
  }
}

export const ledgerService = new LedgerService();
