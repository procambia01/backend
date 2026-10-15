import { prisma } from '@/config/database';
import { BadRequestError, ConflictError, ForbiddenError, LimitExceededError, NotFoundError, PlanRequiredError } from '@/utils/error.util';
import { auditService } from './audit.service';
import { limitService } from './limit.service';
import { notificationService } from './notification.service';

export interface BusinessProfileInput {
  legalName: string;
  tradingName?: string;
  country: string;
  registrationNumber?: string;
  website?: string;
  description?: string;
}

export class BusinessService {
  private async assertBusiness(userId: string) {
    const limits = await limitService.forUser(userId);
    if (limits.maxTeamMembers <= 0 && !limits.sources.includes('BUSINESS')) throw new PlanRequiredError('A Business plan is required');
    return limits;
  }

  async getProfile(userId: string) {
    return prisma.businessProfile.findUnique({ where: { ownerId: userId } });
  }

  /** `verified` is never writable here: only a staff-approved business VerificationCase sets it. */
  async upsertProfile(userId: string, input: BusinessProfileInput) {
    await this.assertBusiness(userId);
    if (input.website && !/^https:\/\//i.test(input.website)) throw new BadRequestError('Website must use https');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { businessVerified: true } });
    return prisma.businessProfile.upsert({
      where: { ownerId: userId },
      create: { ownerId: userId, ...input, verified: user.businessVerified, verifiedAt: user.businessVerified ? new Date() : null },
      update: { ...input },
    });
  }

  async team(userId: string) {
    const rows = await prisma.businessMember.findMany({ where: { ownerId: userId }, orderBy: { invitedAt: 'desc' } });
    const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.memberId) } }, select: { id: true, name: true, email: true } });
    return rows.map((r) => ({ id: r.id, role: r.role, status: r.status, invitedAt: r.invitedAt.toISOString(), member: users.find((u) => u.id === r.memberId) ?? null }));
  }

  async invite(ownerId: string, email: string, role = 'MEMBER') {
    const limits = await this.assertBusiness(ownerId);
    const count = await prisma.businessMember.count({ where: { ownerId, status: { in: ['ACTIVE', 'INVITED'] } } });
    if (count >= limits.maxTeamMembers) throw new LimitExceededError('Team member limit reached', { limit: 'maxTeamMembers', max: limits.maxTeamMembers });
    const member = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!member || member.deletedAt) throw new NotFoundError('No CashMouver account uses that email');
    if (member.id === ownerId) throw new BadRequestError('You are already the owner');
    try {
      await prisma.businessMember.create({ data: { ownerId, memberId: member.id, role, status: 'INVITED' } });
    } catch {
      throw new ConflictError('This person is already on your team');
    }
    await notificationService.notify({ userId: member.id, type: 'SYSTEM_ALERT', params: { message: 'You were invited to join a CashMouver Business team.' }, route: 'PROFILE', dedupeKey: `team-invite:${ownerId}:${member.id}` });
    await auditService.record({ actorId: ownerId, action: 'business.invite', targetType: 'BusinessMember', targetId: member.id });
  }

  async respond(memberId: string, ownerId: string, accept: boolean) {
    const r = await prisma.businessMember.updateMany({ where: { ownerId, memberId, status: 'INVITED' }, data: { status: accept ? 'ACTIVE' : 'DECLINED' } });
    if (r.count !== 1) throw new NotFoundError('Invitation not found');
  }

  async removeMember(ownerId: string, memberId: string) {
    const r = await prisma.businessMember.deleteMany({ where: { ownerId, memberId } });
    if (r.count !== 1) throw new NotFoundError('Member not found');
    await auditService.record({ actorId: ownerId, action: 'business.remove_member', targetType: 'BusinessMember', targetId: memberId });
  }

  async leave(memberId: string, ownerId: string) {
    if (memberId === ownerId) throw new ForbiddenError();
    await prisma.businessMember.deleteMany({ where: { ownerId, memberId } });
  }
}

export const businessService = new BusinessService();
