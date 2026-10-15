import type { RateAlert } from '@prisma/client';
import { prisma } from '@/config/database';
import type { RateAlertDto, RateAlertRequest } from '@/contracts';
import { rateToScaled, scaledToRate } from '@/lib/money';
import { BadRequestError, ConflictError, NotFoundError, ValidationError } from '@/utils/error.util';
import { currencyService } from './currency.service';
import { exchangeRateService } from './exchangeRate.service';
import { limitService } from './limit.service';
import { notificationService } from './notification.service';

const toDto = (a: RateAlert): RateAlertDto => ({
  id: a.id, baseCurrency: a.baseCurrency, quoteCurrency: a.quoteCurrency, targetRate: scaledToRate(a.targetRateScaled), direction: a.direction,
  isActive: a.isActive, lastTriggeredAt: a.lastTriggeredAt?.toISOString() ?? null, triggerCount: a.triggerCount, createdAt: a.createdAt.toISOString(),
});

export class RateAlertService {
  async create(userId: string, input: RateAlertRequest): Promise<RateAlertDto> {
    if (input.baseCurrency === input.quoteCurrency) throw new BadRequestError('Currencies must differ');
    await Promise.all([currencyService.assertActive(input.baseCurrency), currencyService.assertActive(input.quoteCurrency)]);
    await limitService.assertCanCreateAlert(userId);
    let target: bigint;
    try {
      target = rateToScaled(input.targetRate);
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
    const dup = await prisma.rateAlert.count({ where: { userId, baseCurrency: input.baseCurrency, quoteCurrency: input.quoteCurrency, targetRateScaled: target, direction: input.direction, isActive: true } });
    if (dup) throw new ConflictError('You already have this alert');
    return toDto(await prisma.rateAlert.create({ data: { userId, baseCurrency: input.baseCurrency, quoteCurrency: input.quoteCurrency, targetRateScaled: target, direction: input.direction } }));
  }

  async list(userId: string) {
    return (await prisma.rateAlert.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 })).map(toDto);
  }

  async setActive(userId: string, id: string, isActive: boolean) {
    if (isActive) await limitService.assertCanCreateAlert(userId);
    const r = await prisma.rateAlert.updateMany({ where: { id, userId }, data: { isActive } });
    if (r.count !== 1) throw new NotFoundError('Alert not found');
  }

  async remove(userId: string, id: string) {
    const r = await prisma.rateAlert.deleteMany({ where: { id, userId } });
    if (r.count !== 1) throw new NotFoundError('Alert not found');
  }

  /** Job: compare each active alert with the current reference rate and notify (cool-down aware, once per trigger). */
  async evaluateAll(now = new Date()): Promise<number> {
    const alerts = await prisma.rateAlert.findMany({ where: { isActive: true }, take: 5000 });
    const rates = new Map<string, bigint | null>();
    let fired = 0;
    for (const a of alerts) {
      const key = `${a.baseCurrency}/${a.quoteCurrency}`;
      if (!rates.has(key)) rates.set(key, await exchangeRateService.getRateScaled(a.baseCurrency, a.quoteCurrency).then((r) => r.rateScaled).catch(() => null));
      const current = rates.get(key);
      if (!current) continue;
      const hit = a.direction === 'ABOVE' ? current >= a.targetRateScaled : current <= a.targetRateScaled;
      if (!hit) continue;
      const cutoff = new Date(now.getTime() - a.cooldownMinutes * 60_000);
      // Claim the trigger atomically so overlapping job runs notify once.
      const claimed = await prisma.rateAlert.updateMany({
        where: { id: a.id, isActive: true, OR: [{ lastTriggeredAt: null }, { lastTriggeredAt: { lte: cutoff } }] },
        data: { lastTriggeredAt: now, triggerCount: { increment: 1 } },
      });
      if (claimed.count !== 1) continue;
      fired++;
      await notificationService.notify({
        userId: a.userId, type: 'RATE_ALERT', entityId: a.id,
        params: { pair: key, rate: scaledToRate(current, 4), target: scaledToRate(a.targetRateScaled, 4) },
        dedupeKey: `ratealert:${a.id}:${now.toISOString().slice(0, 13)}`,
      });
    }
    return fired;
  }
}

export const rateAlertService = new RateAlertService();
