// src/repositories/user.repository.ts
import { prisma } from '@/config/database';
import { BaseRepository } from './base.repository';
import type { User } from '@prisma/client';

export class UserRepository extends BaseRepository<User> {
  protected model = 'user';

  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  findActiveUsers(page = 1, perPage = 20) {
    const skip = (page - 1) * perPage;
    return Promise.all([
      prisma.user.findMany({ where: { isActive: true, deletedAt: null }, skip, take: perPage }),
      prisma.user.count({ where: { isActive: true, deletedAt: null } }),
    ]);
  }
}

// src/repositories/offer.repository.ts
export class OfferRepository {
  findActive(params: { page: number; perPage: number; haveCurrency?: string; wantCurrency?: string }) {
    const { page, perPage, haveCurrency, wantCurrency } = params;
    const where = {
      status: 'ACTIVE' as const,
      ...(haveCurrency && { haveCurrency }),
      ...(wantCurrency && { wantCurrency }),
    };
    return Promise.all([
      prisma.swapOffer.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, image: true, rating: true, totalSwaps: true, idVerified: true, trustScore: true } } },
      }),
      prisma.swapOffer.count({ where }),
    ]);
  }
}

// src/repositories/swap.repository.ts
export class SwapRepository {
  findByUser(userId: string, page = 1, perPage = 20) {
    const where = { OR: [{ initiatorId: userId }, { receiverId: userId }] };
    return Promise.all([
      prisma.swap.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          initiator: { select: { id: true, name: true, image: true, rating: true, totalSwaps: true, idVerified: true, trustScore: true } },
          receiver:  { select: { id: true, name: true, image: true, rating: true, totalSwaps: true, idVerified: true, trustScore: true } },
        },
      }),
      prisma.swap.count({ where }),
    ]);
  }
}

// src/repositories/message.repository.ts
export class MessageRepository {
  findBySwap(swapId: string, page = 1, perPage = 30) {
    return Promise.all([
      prisma.message.findMany({
        where: { swapId, isDeleted: false },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { sender: { select: { id: true, name: true, image: true } } },
      }),
      prisma.message.count({ where: { swapId, isDeleted: false } }),
    ]);
  }

  markAllRead(swapId: string, userId: string) {
    return prisma.message.updateMany({
      where: { swapId, senderId: { not: userId }, isRead: false },
      data:  { isRead: true, readAt: new Date() },
    });
  }
}

// src/repositories/notification.repository.ts
export class NotificationRepository {
  findByUser(userId: string, page = 1, perPage = 20) {
    return Promise.all([
      prisma.notification.findMany({
        where: { userId },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where: { userId } }),
    ]);
  }

  countUnread(userId: string) {
    return prisma.notification.count({ where: { userId, isRead: false } });
  }
}

// src/repositories/transaction.repository.ts
export class TransactionRepository {
  findByUser(userId: string, page = 1, perPage = 20) {
    return Promise.all([
      prisma.transaction.findMany({
        where: { userId },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.count({ where: { userId } }),
    ]);
  }
}

// src/repositories/referral.repository.ts
export class ReferralRepository {
  findByReferrer(referrerId: string) {
    return prisma.referral.findMany({
      where: { referrerId },
      include: { referred: { select: { id: true, name: true, image: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByCode(code: string) {
    return prisma.referral.findFirst({ where: { code } });
  }
}

// src/repositories/rating.repository.ts
export class RatingRepository {
  findByReceiver(receiverId: string, page = 1, perPage = 20) {
    return Promise.all([
      prisma.rating.findMany({
        where: { receiverId, isHidden: false },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { giver: { select: { id: true, name: true, image: true } } },
      }),
      prisma.rating.count({ where: { receiverId, isHidden: false } }),
    ]);
  }
}

// src/repositories/dispute.repository.ts
export class DisputeRepository {
  findOpen(page = 1, perPage = 20) {
    return Promise.all([
      prisma.dispute.findMany({
        where: { status: 'OPEN' },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        include: {
          reporter: { select: { id: true, name: true, image: true } },
          swap: true,
        },
      }),
      prisma.dispute.count({ where: { status: 'OPEN' } }),
    ]);
  }
}
