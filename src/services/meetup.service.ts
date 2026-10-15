import type { Meetup, Swap } from '@prisma/client';
import { prisma } from '@/config/database';
import type { MeetupDto, ProposeMeetupRequest } from '@/contracts';
import { toGeoPoint } from '@/lib/geo';
import { roleOf, toMeetupDto } from '@/presenters/swap.presenter';
import { ConflictError, ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from '@/utils/error.util';
import { notificationService } from './notification.service';
import { reservationService } from './reservation.service';
import { swapService } from './swap.service';

const OPEN = ['PROPOSED', 'COUNTER_PROPOSED', 'RESCHEDULED'] as const;
const LIVE = ['PROPOSED', 'COUNTER_PROPOSED', 'RESCHEDULED', 'ACCEPTED'] as const;
const CHECKIN_EARLY_MS = 2 * 3_600_000;
const CHECKIN_LATE_MS = 12 * 3_600_000;

export class MeetupService {
  private async loadSwap(swapId: string, userId: string): Promise<Swap> {
    const swap = await prisma.swap.findUnique({ where: { id: swapId } });
    if (!swap || !roleOf(swap, userId)) throw new NotFoundError('Swap not found');
    return swap;
  }

  private async loadMeetup(meetupId: string, userId: string): Promise<{ meetup: Meetup; swap: Swap }> {
    const meetup = await prisma.meetup.findUnique({ where: { id: meetupId } });
    if (!meetup) throw new NotFoundError('Meetup not found');
    const swap = await this.loadSwap(meetup.swapId, userId);
    return { meetup, swap };
  }

  async current(userId: string, swapId: string): Promise<MeetupDto | null> {
    const swap = await this.loadSwap(swapId, userId);
    const m = await prisma.meetup.findFirst({ where: { swapId, status: { in: [...LIVE, 'COMPLETED'] } }, orderBy: { createdAt: 'desc' } });
    return m ? toMeetupDto(m, swap, userId) : null;
  }

  async history(userId: string, swapId: string): Promise<MeetupDto[]> {
    const swap = await this.loadSwap(swapId, userId);
    const rows = await prisma.meetup.findMany({ where: { swapId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((m) => toMeetupDto(m, swap, userId));
  }

  /** Propose, counter-propose or reschedule — decided by what is currently open. */
  async propose(userId: string, swapId: string, input: ProposeMeetupRequest): Promise<MeetupDto> {
    const swap = await this.loadSwap(swapId, userId);
    if (!['AGREED', 'IN_PROGRESS'].includes(swap.status)) throw new InvalidStateError('A meetup can be proposed once the swap is agreed');

    const scheduledAt = new Date(input.scheduledAt);
    const now = Date.now();
    if (scheduledAt.getTime() < now + 15 * 60_000) throw new ValidationError('The meetup must be at least 15 minutes from now');
    if (scheduledAt.getTime() > now + 14 * 86_400_000) throw new ValidationError('The meetup must be within 14 days');
    if ((input.latitude === undefined) !== (input.longitude === undefined)) throw new ValidationError('Provide both latitude and longitude');

    const current = await prisma.meetup.findFirst({ where: { swapId, status: { in: [...LIVE] } }, orderBy: { createdAt: 'desc' } });
    let status: Meetup['status'] = 'PROPOSED';
    let parentId: string | undefined;
    if (current) {
      parentId = current.id;
      status = current.status === 'ACCEPTED' ? 'RESCHEDULED' : 'COUNTER_PROPOSED';
      // Newer open proposals replace older open ones from either side.
      if (current.status !== 'ACCEPTED') {
        await prisma.meetup.updateMany({ where: { id: current.id, status: current.status }, data: { status: 'SUPERSEDED' } });
      }
    }
    const meetup = await prisma.meetup.create({
      data: {
        swapId, proposedById: userId, parentId, status,
        locationName: input.locationName, approximateAddress: input.approximateAddress,
        exactAddress: input.exactAddress, privateNotes: input.privateNotes,
        location: input.latitude !== undefined ? toGeoPoint({ latitude: input.latitude, longitude: input.longitude! }) : undefined,
        scheduledAt,
        // The proposer implicitly agrees to their own proposal.
        initiatorConfirmed: swap.initiatorId === userId, receiverConfirmed: swap.receiverId === userId,
      },
    });
    await swapService.record(swapId, 'MEETUP_PROPOSED', { actorId: userId, metadata: { meetupId: meetup.id, status }, dedupeKey: `MEETUP_PROPOSED:${meetup.id}` });
    const other = swap.initiatorId === userId ? swap.receiverId : swap.initiatorId;
    const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
    await notificationService.notify({ userId: other, type: 'MEETUP_PROPOSED', entityId: swapId, params: { name: me.name.split(' ')[0] }, dedupeKey: `meetup:${meetup.id}:proposed` });
    return toMeetupDto(meetup, swap, userId);
  }

  async accept(userId: string, meetupId: string): Promise<MeetupDto> {
    const { meetup, swap } = await this.loadMeetup(meetupId, userId);
    if (meetup.proposedById === userId) throw new ForbiddenError('You cannot accept your own proposal');
    if (!['AGREED', 'IN_PROGRESS'].includes(swap.status)) throw new InvalidStateError('The swap is not open for meetups');
    if (meetup.scheduledAt.getTime() < Date.now()) throw new InvalidStateError('This proposal is in the past');

    const claimed = await prisma.meetup.updateMany({
      where: { id: meetupId, status: { in: [...OPEN] } },
      data: { status: 'ACCEPTED', initiatorConfirmed: true, receiverConfirmed: true },
    });
    if (claimed.count !== 1) throw new ConflictError('This proposal is no longer open');
    // Only one accepted meetup per swap.
    await prisma.meetup.updateMany({ where: { swapId: swap.id, id: { not: meetupId }, status: { in: [...LIVE] } }, data: { status: 'SUPERSEDED' } });

    // Keep the agreement alive until the meetup has happened.
    if (swap.status === 'AGREED') {
      const until = new Date(Math.max(swap.expiresAt.getTime(), meetup.scheduledAt.getTime() + 24 * 3_600_000));
      await prisma.swap.updateMany({ where: { id: swap.id, status: 'AGREED' }, data: { expiresAt: until } });
      await reservationService.extend(swap.id, until);
    }
    await swapService.record(swap.id, 'MEETUP_ACCEPTED', { actorId: userId, metadata: { meetupId }, dedupeKey: `MEETUP_ACCEPTED:${meetupId}` });
    await notificationService.notify({ userId: meetup.proposedById, type: 'MEETUP_ACCEPTED', entityId: swap.id, params: { name: '' }, dedupeKey: `meetup:${meetupId}:accepted` });
    return toMeetupDto(await prisma.meetup.findUniqueOrThrow({ where: { id: meetupId } }), swap, userId);
  }

  async cancel(userId: string, meetupId: string): Promise<MeetupDto> {
    const { meetup, swap } = await this.loadMeetup(meetupId, userId);
    const r = await prisma.meetup.updateMany({ where: { id: meetupId, status: { in: [...LIVE] } }, data: { status: 'CANCELLED', cancelledById: userId, cancelledAt: new Date() } });
    if (r.count !== 1) throw new ConflictError('This meetup can no longer be cancelled');
    await swapService.record(swap.id, 'MEETUP_CANCELLED', { actorId: userId, metadata: { meetupId }, dedupeKey: `MEETUP_CANCELLED:${meetupId}` });
    const other = swap.initiatorId === userId ? swap.receiverId : swap.initiatorId;
    await notificationService.notify({ userId: other, type: 'MEETUP_PROPOSED', entityId: swap.id, params: { name: '' }, dedupeKey: `meetup:${meetupId}:cancelled` });
    return toMeetupDto({ ...meetup, status: 'CANCELLED' }, swap, userId);
  }

  async checkIn(userId: string, meetupId: string): Promise<MeetupDto> {
    const { meetup, swap } = await this.loadMeetup(meetupId, userId);
    if (!['ACCEPTED', 'RESCHEDULED'].includes(meetup.status)) throw new InvalidStateError('This meetup has not been agreed');
    const t = Date.now();
    if (t < meetup.scheduledAt.getTime() - CHECKIN_EARLY_MS) throw new InvalidStateError('Check-in opens 2 hours before the meetup');
    if (t > meetup.scheduledAt.getTime() + CHECKIN_LATE_MS) throw new InvalidStateError('Check-in has closed for this meetup');

    const isInitiator = swap.initiatorId === userId;
    const field = isInitiator ? 'initiatorCheckedInAt' : 'receiverCheckedInAt';
    await prisma.meetup.updateMany({ where: { id: meetupId, [field]: null }, data: { [field]: new Date() } });
    const m = await prisma.meetup.findUniqueOrThrow({ where: { id: meetupId } });
    if (m.initiatorCheckedInAt && m.receiverCheckedInAt && swap.status === 'AGREED') {
      await swapService.start({ userId: null, role: 'SYSTEM' }, swap.id).catch(() => undefined);
    }
    return toMeetupDto(m, swap, userId);
  }

  async checkOut(userId: string, meetupId: string): Promise<MeetupDto> {
    const { meetup, swap } = await this.loadMeetup(meetupId, userId);
    const isInitiator = swap.initiatorId === userId;
    const inField = isInitiator ? meetup.initiatorCheckedInAt : meetup.receiverCheckedInAt;
    if (!inField) throw new InvalidStateError('Check in first');
    const field = isInitiator ? 'initiatorCheckedOutAt' : 'receiverCheckedOutAt';
    await prisma.meetup.updateMany({ where: { id: meetupId, [field]: null }, data: { [field]: new Date() } });
    const m = await prisma.meetup.findUniqueOrThrow({ where: { id: meetupId } });
    if (m.initiatorCheckedOutAt && m.receiverCheckedOutAt) {
      await prisma.meetup.updateMany({ where: { id: meetupId, status: { in: ['ACCEPTED', 'RESCHEDULED'] } }, data: { status: 'COMPLETED' } });
    }
    return toMeetupDto(await prisma.meetup.findUniqueOrThrow({ where: { id: meetupId } }), swap, userId);
  }

  /** Participant starts the swap once a meetup is agreed, for when both cannot check in. */
  async startSwap(userId: string, swapId: string) {
    return swapService.startAsParticipant(userId, swapId);
  }
}

export const meetupService = new MeetupService();
