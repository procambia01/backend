import { prisma } from '@/config/database';
import { BadRequestError, NotFoundError } from '@/utils/error.util';
import type { CurrencyDto } from '@/contracts';
import { auditService } from './audit.service';

interface Cached {
  at: number;
  rows: CurrencyDto[];
}
const TTL_MS = 30_000;

export class CurrencyService {
  private cache: Cached | null = null;

  invalidate() {
    this.cache = null;
  }

  private async load(): Promise<CurrencyDto[]> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.rows;
    const rows = await prisma.currency.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    const mapped: CurrencyDto[] = rows.map((c) => ({
      code: c.code, name: c.name, symbol: c.symbol, minorUnit: c.minorUnit, region: c.region,
      isPopular: c.isPopular, sortOrder: c.sortOrder, isActive: c.isActive,
    }));
    this.cache = { at: Date.now(), rows: mapped };
    return mapped;
  }

  async listActive(): Promise<CurrencyDto[]> {
    return (await this.load()).filter((c) => c.isActive).map(({ isActive: _i, ...rest }) => rest);
  }

  async listAll(): Promise<CurrencyDto[]> {
    return this.load();
  }

  async get(code: string): Promise<CurrencyDto> {
    const c = (await this.load()).find((x) => x.code === code.toUpperCase());
    if (!c) throw new NotFoundError(`Unknown currency ${code}`);
    return c;
  }

  /** Throws unless the currency exists AND is currently enabled by an admin. */
  async assertActive(code: string): Promise<CurrencyDto> {
    const c = await this.get(code);
    if (!c.isActive) throw new BadRequestError(`${c.code} is not currently supported`);
    return c;
  }

  /** Synchronous lookup table for presenters (loaded once per call). */
  async unitMap(): Promise<{ get(code: string): number }> {
    const rows = await this.load();
    const m = new Map(rows.map((c) => [c.code, c.minorUnit]));
    return { get: (code: string) => m.get(code.toUpperCase()) ?? 2 };
  }

  async minorUnit(code: string): Promise<number> {
    return (await this.get(code)).minorUnit;
  }

  // ───────────── admin ─────────────

  async adminUpsert(actorId: string, input: { code: string; name: string; symbol: string; minorUnit: number; region: string; isActive?: boolean; isPopular?: boolean; sortOrder?: number }) {
    const code = input.code.toUpperCase();
    const before = await prisma.currency.findUnique({ where: { code } });
    if (before && before.minorUnit !== input.minorUnit) {
      // Changing precision would silently re-scale every stored amount.
      throw new BadRequestError('minorUnit cannot be changed once a currency exists');
    }
    const row = await prisma.currency.upsert({
      where: { code },
      create: { code, name: input.name, symbol: input.symbol, minorUnit: input.minorUnit, region: input.region, isActive: input.isActive ?? true, isPopular: input.isPopular ?? false, sortOrder: input.sortOrder ?? 1000 },
      update: { name: input.name, symbol: input.symbol, region: input.region, isActive: input.isActive, isPopular: input.isPopular, sortOrder: input.sortOrder },
    });
    this.invalidate();
    await auditService.record({ actorId, action: before ? 'currency.update' : 'currency.create', targetType: 'Currency', targetId: row.id, before, after: row });
    return row;
  }

  async adminSetActive(actorId: string, code: string, isActive: boolean, reason?: string) {
    const before = await prisma.currency.findUnique({ where: { code: code.toUpperCase() } });
    if (!before) throw new NotFoundError('Currency not found');
    const row = await prisma.currency.update({ where: { id: before.id }, data: { isActive } });
    this.invalidate();
    await auditService.record({ actorId, action: isActive ? 'currency.activate' : 'currency.deactivate', targetType: 'Currency', targetId: row.id, before: { isActive: before.isActive }, after: { isActive }, reason });
    return row;
  }
}

export const currencyService = new CurrencyService();
