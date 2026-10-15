import type { Dispute, DisputeEvidence, DisputeEvent, DisputeOutcome, DisputePriority, DisputeReason, EvidenceType, Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import type { DisputeDto } from '@/contracts';
import { sha256Hex } from '@/lib/crypto';
import { EVIDENCE_UPLOAD_POLICY, UploadValidationError, validateUpload } from '@/lib/file-signature';
import { BadRequestError, ConflictError, ForbiddenError, InvalidStateError, NotFoundError, UploadInvalidError } from '@/utils/error.util';
import { auditService } from './audit.service';
import { logActivity } from './activity.service';
import { cleanText } from './message.service';
import { notificationService } from './notification.service';
import { riskService } from './risk.service';
import { storageService } from './storage.service';
import { swapService } from './swap.service';

const MAX_EVIDENCE = 10;
const POST_COMPLETION_WINDOW_MS = 7 * 86_400_000;
const PRIORITY: Record<DisputeReason, DisputePriority> = {
  NO_SHOW: 'LOW', WRONG_AMOUNT: 'MEDIUM', FAKE_CURRENCY: 'HIGH', COUNTERFEIT_MONEY: 'URGENT', FRAUD: 'HIGH',
  UNSAFE_BEHAVIOR: 'URGENT', THREATENING_BEHAVIOR: 'URGENT', HARASSMENT: 'HIGH', OTHER: 'MEDIUM',
};

type Full = Dispute & { evidence: DisputeEvidence[]; events: DisputeEvent[] };

export class DisputeService {
  private toDto(d: Full, viewerId: string): DisputeDto {
    return {
      id: d.id, swapId: d.swapId, reason: d.reason, description: d.description, status: d.status, priority: d.priority, isEscalated: d.isEscalated,
      outcome: d.outcome, resolutionNote: d.resolutionNote, iAmReporter: d.reporterId === viewerId,
      evidence: d.evidence.map((e) => ({ id: e.id, type: e.type, mimeType: e.mimeType, sizeBytes: e.sizeBytes, uploadedByMe: e.uploaderId === viewerId, createdAt: e.createdAt.toISOString() })),
      events: d.events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((e) => ({ id: e.id, type: e.type, note: e.note, createdAt: e.createdAt.toISOString() })),
      createdAt: d.createdAt.toISOString(), resolvedAt: d.resolvedAt?.toISOString() ?? null,
    };
  }

  private async event(disputeId: string, actorId: string | null, type: string, note?: string, metadata?: Record<string, unknown>) {
    await prisma.disputeEvent.create({ data: { disputeId, actorId, type, note, metadata: (metadata ?? {}) as Prisma.InputJsonValue } });
  }

  private async load(id: string, userId: string, staff = false): Promise<Full> {
    const d = await prisma.dispute.findUnique({ where: { id }, include: { evidence: true, events: true } });
    if (!d || (!staff && d.reporterId !== userId && d.againstId !== userId)) throw new NotFoundError('Dispute not found');
    return d;
  }

  async open(reporterId: string, input: { swapId: string; reason: DisputeReason; description: string }) {
    const swap = await prisma.swap.findUnique({ where: { id: input.swapId } });
    if (!swap || (swap.initiatorId !== reporterId && swap.receiverId !== reporterId)) throw new NotFoundError('Swap not found');
    const againstId = swap.initiatorId === reporterId ? swap.receiverId : swap.initiatorId;

    const postCompletion = swap.status === 'COMPLETED' && swap.completedAt && Date.now() - swap.completedAt.getTime() <= POST_COMPLETION_WINDOW_MS;
    if (!['IN_PROGRESS', 'CONFIRMING', 'DISPUTED'].includes(swap.status) && !postCompletion) {
      throw new InvalidStateError('A dispute can be opened while the exchange is in progress or within 7 days after completion');
    }
    if (await prisma.dispute.count({ where: { swapId: swap.id, reporterId, status: { in: ['OPEN', 'INVESTIGATING'] } } })) throw new ConflictError('You already have an open dispute for this swap');

    // Freeze the swap (state machine: IN_PROGRESS|CONFIRMING → DISPUTED). Completed swaps keep their status.
    if (swap.status === 'IN_PROGRESS' || swap.status === 'CONFIRMING') {
      await swapService.markDisputed(swap.id, { userId: reporterId, role: swap.initiatorId === reporterId ? 'INITIATOR' : 'RECEIVER' });
    }
    const d = await prisma.dispute.create({
      data: { swapId: swap.id, reporterId, againstId, reason: input.reason, description: cleanText(input.description).slice(0, 2000), priority: PRIORITY[input.reason] },
    });
    await this.event(d.id, reporterId, 'OPENED', undefined, { reason: input.reason });
    await prisma.user.update({ where: { id: againstId }, data: { disputedSwaps: { increment: 1 } } });
    await logActivity(reporterId, 'DISPUTE_FILED', 'Dispute opened', { disputeId: d.id });
    await notificationService.notify({ userId: againstId, type: 'DISPUTE_OPENED', entityId: d.id, dedupeKey: `dispute:${d.id}:opened:${againstId}` });
    await notificationService.notify({ userId: reporterId, type: 'DISPUTE_OPENED', entityId: d.id, dedupeKey: `dispute:${d.id}:opened:${reporterId}` });
    void riskService.onDisputeAgainst(againstId).catch(() => undefined);
    return this.toDto(await this.load(d.id, reporterId), reporterId);
  }

  async get(userId: string, id: string) {
    return this.toDto(await this.load(id, userId), userId);
  }

  async mine(userId: string, page: number, perPage: number) {
    const where = { OR: [{ reporterId: userId }, { againstId: userId }] };
    const [rows, total] = await Promise.all([
      prisma.dispute.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage, include: { evidence: true, events: true } }),
      prisma.dispute.count({ where }),
    ]);
    return { items: rows.map((d) => this.toDto(d, userId)), total };
  }

  async addEvidence(userId: string, disputeId: string, file: { buffer: Buffer; mimetype: string }, type: EvidenceType, note?: string) {
    const d = await this.load(disputeId, userId);
    if (!['OPEN', 'INVESTIGATING'].includes(d.status)) throw new InvalidStateError('Evidence can no longer be added');
    if (d.evidence.length >= MAX_EVIDENCE) throw new ConflictError('Evidence limit reached');
    let mime;
    try {
      mime = validateUpload(file.buffer, file.mimetype, EVIDENCE_UPLOAD_POLICY);
    } catch (e) {
      if (e instanceof UploadValidationError) throw new UploadInvalidError(e.message);
      throw e;
    }
    const hash = sha256Hex(file.buffer);
    if (d.evidence.some((e) => e.sha256 === hash)) throw new ConflictError('This file was already uploaded');
    const key = await storageService.putPrivate(file.buffer, mime, `disputes/${disputeId}`, `${userId}_${Date.now()}_${hash.slice(0, 10)}`);
    const ev = await prisma.disputeEvidence.create({
      data: { disputeId, uploaderId: userId, type, storageKey: key, mimeType: mime, sizeBytes: file.buffer.length, sha256: hash, metadata: { note: note ? cleanText(note).slice(0, 300) : null } },
    });
    await this.event(disputeId, userId, 'EVIDENCE_ADDED', undefined, { evidenceId: ev.id, type });
    const other = d.reporterId === userId ? d.againstId : d.reporterId;
    await notificationService.notify({ userId: other, type: 'DISPUTE_OPENED', entityId: disputeId, dedupeKey: `dispute:${disputeId}:evidence:${ev.id}` });
    return { id: ev.id };
  }

  /** Participants and staff only; staff access is audited. */
  async evidenceUrl(viewerId: string, isStaff: boolean, evidenceId: string) {
    const ev = await prisma.disputeEvidence.findUnique({ where: { id: evidenceId }, include: { dispute: true } });
    if (!ev) throw new NotFoundError('Evidence not found');
    const participant = ev.dispute.reporterId === viewerId || ev.dispute.againstId === viewerId;
    if (!participant && !isStaff) throw new NotFoundError('Evidence not found');
    if (!participant) await auditService.record({ actorId: viewerId, action: 'dispute.evidence_viewed', targetType: 'DisputeEvidence', targetId: evidenceId });
    return { url: storageService.signedUrl(ev.storageKey, 120), mimeType: ev.mimeType };
  }

  async comment(userId: string, disputeId: string, note: string) {
    const d = await this.load(disputeId, userId);
    if (!['OPEN', 'INVESTIGATING'].includes(d.status)) throw new InvalidStateError('This dispute is closed');
    await this.event(disputeId, userId, 'COMMENT', cleanText(note).slice(0, 1000));
  }

  // ───────────── staff ─────────────

  async adminList(q: { status?: Dispute['status']; page: number; perPage: number }) {
    const where = q.status ? { status: q.status } : {};
    const [rows, total] = await Promise.all([
      prisma.dispute.findMany({ where, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], skip: (q.page - 1) * q.perPage, take: q.perPage, include: { evidence: true, events: true } }),
      prisma.dispute.count({ where }),
    ]);
    return { items: rows.map((d) => ({ ...this.toDto(d, ''), reporterId: d.reporterId, againstId: d.againstId, assignedTo: d.assignedTo })), total };
  }

  async adminGet(id: string) {
    const d = await this.load(id, '', true);
    return { ...this.toDto(d, ''), reporterId: d.reporterId, againstId: d.againstId, assignedTo: d.assignedTo };
  }

  async startInvestigation(staffId: string, id: string) {
    const d = await this.load(id, staffId, true);
    if (d.reporterId === staffId || d.againstId === staffId) throw new ForbiddenError('You are a party to this dispute');
    const r = await prisma.dispute.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'INVESTIGATING', assignedTo: staffId } });
    if (r.count !== 1) throw new ConflictError('Dispute is not open');
    await this.event(id, staffId, 'INVESTIGATING');
    await auditService.record({ actorId: staffId, action: 'dispute.investigate', targetType: 'Dispute', targetId: id });
  }

  /**
   * Resolution only affects the swap RECORD, reputation and account standing.
   * CashMouver never refunds, releases or moves the exchanged currency.
   */
  async resolve(staffId: string, id: string, input: { outcome: DisputeOutcome; note: string; swapOutcome?: 'COMPLETED' | 'CANCELLED' }) {
    const d = await this.load(id, staffId, true);
    if (d.reporterId === staffId || d.againstId === staffId) throw new ForbiddenError('You are a party to this dispute');
    if (d.status !== 'INVESTIGATING') throw new InvalidStateError('Start the investigation before resolving');
    const swap = await prisma.swap.findUniqueOrThrow({ where: { id: d.swapId } });

    if (input.outcome === 'ESCALATED') {
      await prisma.dispute.update({ where: { id }, data: { isEscalated: true, priority: 'URGENT', resolutionNote: input.note } });
      await this.event(id, staffId, 'ESCALATED', input.note);
      await auditService.record({ actorId: staffId, action: 'dispute.escalate', targetType: 'Dispute', targetId: id, reason: input.note });
      return;
    }

    let swapOutcome: 'COMPLETED' | 'CANCELLED' | undefined;
    if (input.outcome === 'SWAP_COMPLETED') swapOutcome = 'COMPLETED';
    else if (input.outcome === 'SWAP_CANCELLED') swapOutcome = 'CANCELLED';
    else swapOutcome = input.swapOutcome;
    if (swap.status === 'DISPUTED' && !swapOutcome) throw new BadRequestError('swapOutcome is required to settle the disputed swap');

    const claimed = await prisma.dispute.updateMany({
      where: { id, status: 'INVESTIGATING' },
      data: { status: 'RESOLVED', outcome: input.outcome, resolutionNote: input.note, resolvedById: staffId, resolvedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ConflictError('Dispute was already resolved');

    if (swap.status === 'DISPUTED' && swapOutcome) await swapService.resolveDisputed(swap.id, staffId, swapOutcome, input.note);

    if (input.outcome === 'WARNING') {
      await notificationService.notify({ userId: d.againstId, type: 'ACCOUNT_WARNING', entityId: id, params: { message: input.note }, route: 'DISPUTE', dedupeKey: `dispute:${id}:warning` });
    }
    if (input.outcome === 'ACCOUNT_RESTRICTION') {
      await prisma.user.update({ where: { id: d.againstId }, data: { tradingRestricted: true } });
      await notificationService.notify({ userId: d.againstId, type: 'ACCOUNT_WARNING', entityId: id, params: { message: 'Trading on your account has been restricted following a dispute.' }, route: 'DISPUTE', dedupeKey: `dispute:${id}:restriction` });
    }
    await this.event(id, staffId, 'RESOLVED', input.note, { outcome: input.outcome, swapOutcome });
    await auditService.record({ actorId: staffId, action: 'dispute.resolve', targetType: 'Dispute', targetId: id, before: { status: 'INVESTIGATING' }, after: { status: 'RESOLVED', outcome: input.outcome, swapOutcome }, reason: input.note });
    for (const uid of [d.reporterId, d.againstId]) {
      await notificationService.notify({ userId: uid, type: 'DISPUTE_RESOLVED', entityId: id, dedupeKey: `dispute:${id}:resolved:${uid}` });
    }
  }

  async close(staffId: string, id: string) {
    const r = await prisma.dispute.updateMany({ where: { id, status: 'RESOLVED' }, data: { status: 'CLOSED', closedAt: new Date() } });
    if (r.count !== 1) throw new ConflictError('Only resolved disputes can be closed');
    await this.event(id, staffId, 'CLOSED');
    await auditService.record({ actorId: staffId, action: 'dispute.close', targetType: 'Dispute', targetId: id });
  }

  async autoCloseResolved(now = new Date()): Promise<number> {
    const r = await prisma.dispute.updateMany({ where: { status: 'RESOLVED', resolvedAt: { lte: new Date(now.getTime() - 7 * 86_400_000) } }, data: { status: 'CLOSED', closedAt: now } });
    return r.count;
  }
}

export const disputeService = new DisputeService();
