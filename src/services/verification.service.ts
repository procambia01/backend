// src/services/verification.service.ts
import { prisma } from '@/config/database';
import { VerificationStatus } from '@prisma/client';
import { NotFoundError } from '@/utils/error.util';
import logger from '@/utils/logger.util';

export class VerificationService {
  async submitVerification(
    userId: string,
    data: {
      documentType: string;
      frontDocumentUrl: string;
      backDocumentUrl?: string;
      selfieUrl: string;
    },
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        verificationStatus: VerificationStatus.PENDING,
        idDocumentUrl: data.frontDocumentUrl,
        selfieUrl: data.selfieUrl,
      },
      select: { id: true, verificationStatus: true },
    });

    logger.info(`Verification submitted for user ${userId}`);
    return updated;
  }

  async approveVerification(userId: string, adminId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        verificationStatus: VerificationStatus.VERIFIED,
        idVerified: true,
      },
    });

    await prisma.adminLog.create({
      data: {
        adminId,
        action: 'USER_VERIFIED',
        targetType: 'User',
        targetId: userId,
        details: 'Identity verification approved',
      },
    });

    logger.info(`Verification approved for user ${userId} by admin ${adminId}`);
    return updated;
  }

  async rejectVerification(userId: string, adminId: string, reason: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { verificationStatus: VerificationStatus.REJECTED },
    });

    await prisma.adminLog.create({
      data: {
        adminId,
        action: 'USER_REJECTED',
        targetType: 'User',
        targetId: userId,
        details: `Verification rejected: ${reason}`,
      },
    });

    return updated;
  }

  async getVerificationStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { verificationStatus: true, idDocumentUrl: true, selfieUrl: true },
    });
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  async getPendingVerifications(page = 1, perPage = 20) {
    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where: { verificationStatus: VerificationStatus.PENDING },
        select: {
          id: true, name: true, email: true, image: true,
          idDocumentUrl: true, selfieUrl: true, createdAt: true,
          phone: true, totalSwaps: true,
        },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'asc' },
      }),
      prisma.user.count({ where: { verificationStatus: VerificationStatus.PENDING } }),
    ]);
    return { data, meta: { page, perPage, total } };
  }
}
