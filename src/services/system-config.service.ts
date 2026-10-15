import { prisma } from '@/config/database';
import { auditService } from './audit.service';

/** Platform settings editable by admins. Defaults are only used until an admin saves a value. */
export const CONFIG_DEFAULTS: Record<string, { value: string; dataType: 'int' | 'bool' | 'string'; description: string; category: string; isPublic?: boolean }> = {
  'swap.pendingTtlHours': { value: '24', dataType: 'int', description: 'Hours a swap request may stay PENDING before it expires', category: 'swap' },
  'swap.agreedTtlHours': { value: '72', dataType: 'int', description: 'Hours an AGREED swap may wait for the meetup before it expires', category: 'swap' },
  'swap.requirePhone': { value: 'true', dataType: 'bool', description: 'Require a verified phone number to request or accept swaps', category: 'swap' },
  'swap.maxExtensionHours': { value: '48', dataType: 'int', description: 'Maximum hours a swap request can be extended', category: 'swap' },
  'offer.maxRateDeviationBps': { value: '2000', dataType: 'int', description: 'Maximum deviation (basis points) of an offer rate from the reference rate', category: 'offer' },
  'offer.maxHorizonDays': { value: '90', dataType: 'int', description: 'Furthest an offer may be scheduled to remain available', category: 'offer' },
  'rate.maxAgeMinutes': { value: '360', dataType: 'int', description: 'Reference rates older than this are treated as unavailable for validation', category: 'rates' },
  'risk.largeExchangeEur': { value: '500000', dataType: 'int', description: 'EUR minor units above which an exchange is flagged', category: 'risk' },
  'risk.cancelThreshold7d': { value: '4', dataType: 'int', description: 'Cancellations in 7 days that raise a flag', category: 'risk' },
  'risk.disputeThreshold30d': { value: '2', dataType: 'int', description: 'Disputes in 30 days that raise a flag', category: 'risk' },
  'risk.swapVelocity1h': { value: '6', dataType: 'int', description: 'Swap requests within one hour that raise a flag', category: 'risk' },
  'platform.maintenance': { value: 'false', dataType: 'bool', description: 'Show maintenance mode to clients', category: 'platform', isPublic: true },
  'platform.supportEmail': { value: 'support@cashmouver.com', dataType: 'string', description: 'Support contact address', category: 'platform', isPublic: true },
};

interface Entry {
  at: number;
  value: string | null;
}
const TTL_MS = 30_000;
const cache = new Map<string, Entry>();

export class SystemConfigService {
  invalidate(key?: string) {
    if (key) cache.delete(key);
    else cache.clear();
  }

  async get(key: string): Promise<string> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS && hit.value !== null) return hit.value;
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    const value = row?.value ?? CONFIG_DEFAULTS[key]?.value;
    if (value === undefined) throw new Error(`Unknown config key ${key}`);
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  async getInt(key: string): Promise<number> {
    return Number.parseInt(await this.get(key), 10);
  }
  async getBool(key: string): Promise<boolean> {
    return (await this.get(key)) === 'true';
  }

  async list(publicOnly = false) {
    const rows = await prisma.systemConfig.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return Object.entries(CONFIG_DEFAULTS)
      .filter(([, d]) => !publicOnly || d.isPublic)
      .map(([key, d]) => ({ key, value: byKey.get(key)?.value ?? d.value, dataType: d.dataType, description: d.description, category: d.category, isPublic: !!d.isPublic }));
  }

  async set(actorId: string, key: string, value: string, reason?: string) {
    const def = CONFIG_DEFAULTS[key];
    if (!def) throw new Error('Unknown setting');
    if (def.dataType === 'int' && !/^-?\d+$/.test(value)) throw new Error('Value must be an integer');
    if (def.dataType === 'bool' && !['true', 'false'].includes(value)) throw new Error('Value must be true or false');
    const before = await prisma.systemConfig.findUnique({ where: { key } });
    await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value, dataType: def.dataType, description: def.description, category: def.category, isPublic: !!def.isPublic, updatedBy: actorId },
      update: { value, updatedBy: actorId },
    });
    this.invalidate(key);
    await auditService.record({ actorId, action: 'config.update', targetType: 'SystemConfig', targetId: key, before: before ? { value: before.value } : { value: def.value }, after: { value }, reason });
  }
}

export const systemConfig = new SystemConfigService();
export const systemConfigService = systemConfig;
