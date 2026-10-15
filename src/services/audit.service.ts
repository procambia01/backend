import { prisma, Db } from '@/config/database';
import { getContext } from '@/lib/request-context';
import { redact } from '@/lib/redact';
import logger from '@/utils/logger.util';

export interface AuditInput {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Append-only audit trail. Snapshots are redacted; failures are logged, never swallowed silently. */
export class AuditService {
  async record(input: AuditInput, db: Db = prisma): Promise<void> {
    const ctx = getContext();
    try {
      await db.auditLog.create({
        data: {
          actorId: input.actorId ?? ctx?.userId ?? null,
          actorRole: input.actorRole ?? null,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          before: input.before === undefined ? undefined : (redact(input.before) as object),
          after: input.after === undefined ? undefined : (redact(input.after) as object),
          reason: input.reason ?? null,
          ipAddress: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
        },
      });
    } catch (error) {
      logger.error('audit write failed', { action: input.action, message: (error as Error).message });
      if (db !== prisma) throw error; // inside a transaction the audit row is part of the change
    }
  }
}
export const auditService = new AuditService();
