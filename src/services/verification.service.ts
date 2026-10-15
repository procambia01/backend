import type { VerificationCase, VerificationDocument } from '@prisma/client';
import { prisma } from '@/config/database';
import { config } from '@/config/env';
import { sha256Hex } from '@/lib/crypto';
import { KYC_UPLOAD_POLICY, UploadValidationError, validateUpload } from '@/lib/file-signature';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UploadInvalidError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { toVerificationCaseDto } from '@/presenters/billing.presenter';
import { auditService } from './audit.service';
import { logActivity } from './activity.service';
import { notificationService } from './notification.service';
import { referralService } from './referral.service';
import { riskService } from './risk.service';
import { storageService } from './storage.service';

export interface UploadedFile {
  kind: string;
  buffer: Buffer;
  mimetype: string;
}

export interface SubmitInput {
  type: 'INDIVIDUAL' | 'BUSINESS';
  tier: 'BASIC' | 'ENHANCED';
  documentType: string;
  documentCountry: string;
  businessName?: string;
  registrationNumber?: string;
}

const INDIVIDUAL_REQUIRED = ['ID_FRONT', 'SELFIE'];
const BUSINESS_REQUIRED = ['BUSINESS_REGISTRATION'];
const ALLOWED_KINDS = new Set(['ID_FRONT', 'ID_BACK', 'SELFIE', 'BUSINESS_REGISTRATION', 'PROOF_OF_ADDRESS']);
const months = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d;
};

export const toCaseDto = toVerificationCaseDto;

export class VerificationService {
  // ───────────── user ─────────────

  /**
   * Creates a case. The client can never mark itself verified: only
   * `decide()` (staff/admin) writes verification state on the user.
   */
  async submit(userId: string, input: SubmitInput, files: UploadedFile[]) {
    const open = await prisma.verificationCase.findFirst({ where: { userId, type: input.type, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } });
    if (open) throw new ConflictError('You already have a verification in progress');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (input.type === 'INDIVIDUAL' && user.idVerified && user.verificationStatus === 'VERIFIED' && input.tier === 'BASIC') {
      throw new ConflictError('You are already verified');
    }
    if (input.type === 'BUSINESS' && !input.businessName) throw new BadRequestError('businessName is required for business verification');

    const required = input.type === 'BUSINESS' ? BUSINESS_REQUIRED : INDIVIDUAL_REQUIRED;
    const kinds = new Set(files.map((f) => f.kind));
    for (const k of required) if (!kinds.has(k)) throw new BadRequestError(`Missing document: ${k}`);
    if (files.length > 5) throw new BadRequestError('Too many files');

    const validated: { f: UploadedFile; mime: ReturnType<typeof validateUpload> }[] = [];
    for (const f of files) {
      if (!ALLOWED_KINDS.has(f.kind)) throw new BadRequestError(`Unknown document kind ${f.kind}`);
      try {
        validated.push({ f, mime: validateUpload(f.buffer, f.mimetype, { ...KYC_UPLOAD_POLICY, maxBytes: Math.min(KYC_UPLOAD_POLICY.maxBytes, config.upload.maxFileSize) }) });
      } catch (e) {
        if (e instanceof UploadValidationError) throw new UploadInvalidError(e.message);
        throw e;
      }
    }

    const c = await prisma.verificationCase.create({
      data: {
        userId, type: input.type, tier: input.tier, documentType: input.documentType, documentCountry: input.documentCountry,
        businessName: input.businessName, registrationNumber: input.registrationNumber,
        retainUntil: new Date(Date.now() + config.kyc.documentRetentionDays * 86_400_000 * 4),
      },
    });
    const stored: string[] = [];
    try {
      for (const { f, mime } of validated) {
        const storageKey = await storageService.putPrivate(f.buffer, mime, `kyc/${userId}`, `${c.id}_${f.kind}_${Date.now()}`);
        stored.push(storageKey);
        await prisma.verificationDocument.create({ data: { caseId: c.id, kind: f.kind, storageKey, mimeType: mime, sizeBytes: f.buffer.length, sha256: sha256Hex(f.buffer) } });
      }
    } catch (error) {
      // Never leave a half-uploaded case behind.
      await Promise.all(stored.map((k) => storageService.deletePrivate(k).catch(() => undefined)));
      await prisma.verificationDocument.deleteMany({ where: { caseId: c.id } });
      await prisma.verificationCase.delete({ where: { id: c.id } });
      throw error;
    }
    if (user.verificationStatus !== 'VERIFIED') await prisma.user.update({ where: { id: userId }, data: { verificationStatus: 'PENDING' } });
    await riskService.onVerificationInconsistency(user, input.documentCountry).catch(() => undefined);
    await logActivity(userId, 'VERIFICATION_SUBMITTED', `Verification submitted (${input.type}/${input.tier})`);
    return toCaseDto(await prisma.verificationCase.findUniqueOrThrow({ where: { id: c.id }, include: { documents: true } }));
  }

  async onFeePaid(caseId: string, paymentId: string): Promise<void> {
    const r = await prisma.verificationCase.updateMany({ where: { id: caseId, paymentId: null }, data: { paymentId } });
    if (r.count === 1) {
      const c = await prisma.verificationCase.findUnique({ where: { id: caseId } });
      if (c) await notificationService.notify({ userId: c.userId, type: 'VERIFICATION_UPDATE', params: { status: 'PAID' }, dedupeKey: `verification:${caseId}:paid` });
    }
  }

  async myCases(userId: string) {
    const rows = await prisma.verificationCase.findMany({ where: { userId }, orderBy: { submittedAt: 'desc' }, include: { documents: true }, take: 20 });
    return rows.map(toCaseDto);
  }

  // ───────────── staff / admin ─────────────

  async queue(status: 'SUBMITTED' | 'UNDER_REVIEW', page: number, perPage: number) {
    // Enhanced cases enter the queue only once the fee is paid.
    const where = { status, OR: [{ tier: 'BASIC' as const }, { paymentId: { not: null } }] };
    const [items, total] = await Promise.all([
      prisma.verificationCase.findMany({ where, orderBy: { submittedAt: 'asc' }, skip: (page - 1) * perPage, take: perPage, include: { documents: true, user: { select: { id: true, name: true, email: true, country: true } } } }),
      prisma.verificationCase.count({ where }),
    ]);
    return { items: items.map((c) => ({ ...toCaseDto(c), user: c.user })), total };
  }

  async startReview(caseId: string, reviewerId: string) {
    const c = await prisma.verificationCase.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundError('Case not found');
    if (c.userId === reviewerId) throw new ForbiddenError('You cannot review your own verification');
    if (c.tier === 'ENHANCED' && !c.paymentId) throw new BadRequestError('Enhanced verification fee has not been paid');
    const r = await prisma.verificationCase.updateMany({ where: { id: caseId, status: 'SUBMITTED' }, data: { status: 'UNDER_REVIEW', reviewStartedAt: new Date(), reviewerId } });
    if (r.count !== 1) throw new ConflictError('Case is not awaiting review');
    await auditService.record({ actorId: reviewerId, action: 'verification.review_started', targetType: 'VerificationCase', targetId: caseId });
  }

  async decide(caseId: string, reviewerId: string, decision: 'VERIFIED' | 'REJECTED', reason?: string) {
    const c = await prisma.verificationCase.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundError('Case not found');
    if (c.userId === reviewerId) throw new ForbiddenError('You cannot review your own verification');
    if (decision === 'REJECTED' && (!reason || reason.trim().length < 5)) throw new BadRequestError('A rejection reason is required');

    const now = new Date();
    const expiresAt = months(config.kyc.validMonths);
    const claimed = await prisma.verificationCase.updateMany({
      where: { id: caseId, status: 'UNDER_REVIEW' },
      data: { status: decision, reviewedAt: now, reviewerId, rejectionReason: decision === 'REJECTED' ? reason : null, expiresAt: decision === 'VERIFIED' ? expiresAt : null, retainUntil: new Date(now.getTime() + config.kyc.documentRetentionDays * 86_400_000) },
    });
    if (claimed.count !== 1) throw new ConflictError('Case is not under review');

    if (decision === 'VERIFIED') {
      await prisma.user.update({
        where: { id: c.userId },
        data:
          c.type === 'BUSINESS'
            ? { businessVerified: true }
            : { idVerified: true, verificationStatus: 'VERIFIED', verificationTier: c.tier, verifiedAt: now, verificationExpiresAt: expiresAt },
      });
    } else {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
      if (!(u.idVerified && u.verificationStatus === 'VERIFIED')) await prisma.user.update({ where: { id: c.userId }, data: { verificationStatus: 'REJECTED' } });
    }
    await auditService.record({ actorId: reviewerId, action: `verification.${decision.toLowerCase()}`, targetType: 'VerificationCase', targetId: caseId, before: { status: 'UNDER_REVIEW' }, after: { status: decision }, reason });
    await notificationService.notify({ userId: c.userId, type: 'VERIFICATION_UPDATE', params: { status: decision }, dedupeKey: `verification:${caseId}:${decision}` });
    if (decision === 'VERIFIED') await referralService.onQualifyingEvent(c.userId, 'VERIFIED_AND_SWAP').catch(() => undefined);
  }

  /** Staff-only. Every access is audited and the URL is short-lived. */
  async documentUrl(docId: string, viewerId: string, purpose: string) {
    const doc = await prisma.verificationDocument.findUnique({ where: { id: docId }, include: { case: true } });
    if (!doc || doc.deletedAt) throw new NotFoundError('Document not found');
    if (doc.case.userId === viewerId) throw new ForbiddenError('Use your own account area to manage your documents');
    await auditService.record({ actorId: viewerId, action: 'verification.document_viewed', targetType: 'VerificationDocument', targetId: docId, reason: purpose });
    return { url: storageService.signedUrl(doc.storageKey), expiresInSeconds: config.kyc.signedUrlTtlSeconds, mimeType: doc.mimeType };
  }

  // ───────────── jobs ─────────────

  async expireOutdated(now = new Date()): Promise<number> {
    const users = await prisma.user.findMany({ where: { idVerified: true, verificationExpiresAt: { lte: now } }, select: { id: true }, take: 500 });
    for (const u of users) {
      await prisma.user.update({ where: { id: u.id }, data: { idVerified: false, verificationStatus: 'EXPIRED', verificationTier: 'NONE' } });
      await prisma.verificationCase.updateMany({ where: { userId: u.id, status: 'VERIFIED', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
      await notificationService.notify({ userId: u.id, type: 'VERIFICATION_UPDATE', params: { status: 'EXPIRED' }, dedupeKey: `verification:${u.id}:expired:${now.toISOString().slice(0, 7)}` });
    }
    return users.length;
  }

  /** Retention: delete stored KYC files once the retention window has passed. */
  async purgeExpiredDocuments(now = new Date()): Promise<number> {
    const docs = await prisma.verificationDocument.findMany({ where: { deletedAt: null, case: { retainUntil: { lte: now }, status: { in: ['VERIFIED', 'REJECTED', 'EXPIRED'] } } }, take: 200 });
    let n = 0;
    for (const d of docs) {
      try {
        await storageService.deletePrivate(d.storageKey);
        await prisma.verificationDocument.update({ where: { id: d.id }, data: { deletedAt: now } });
        n++;
      } catch (e) {
        logger.warn('kyc purge failed', { docId: d.id, m: (e as Error).message });
      }
    }
    return n;
  }
}

export const verificationService = new VerificationService();
