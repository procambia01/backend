// src/services/dispute.service.ts
import { prisma } from '@/config/database';
import { PaginationParams } from '@/utils/pagination.util';
import { DisputeStatus, DisputePriority } from '@prisma/client';
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} from '@/utils/error.util';
import logger from '@/utils/logger.util';

export class DisputeService {
  /**
   * Create a new dispute
   */
  async createDispute(userId: string, disputeData: any) {
    // Validate swap exists and user is part of it
    const swap = await prisma.swap.findUnique({
      where: { id: disputeData.swapId },
      include: {
        initiator: true,
        receiver: true,
      },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You can only create disputes for your own swaps');
    }

    // Check if dispute already exists for this swap
    const existingDispute = await prisma.dispute.findFirst({
      where: {
        swapId: disputeData.swapId,
        status: {
          in: [DisputeStatus.OPEN, DisputeStatus.INVESTIGATING, DisputeStatus.ESCALATED],
        },
      },
    });

    if (existingDispute) {
      throw new BadRequestError('An active dispute already exists for this swap');
    }

    const dispute = await prisma.dispute.create({
      data: {
        reporterId: userId,
        swapId: disputeData.swapId,
        reason: disputeData.reason,
        description: disputeData.description,
        evidence: disputeData.evidence || [],
        priority: disputeData.priority || DisputePriority.MEDIUM,
        status: DisputeStatus.OPEN,
      },
      include: {
        reporter: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        swap: {
          include: {
            initiator: {
              select: { id: true, name: true },
            },
            receiver: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    // Update swap status
    await prisma.swap.update({
      where: { id: disputeData.swapId },
      data: { status: 'DISPUTED' },
    });

    // Send notifications
    const otherUserId =
      swap.initiatorId === userId ? swap.receiverId : swap.initiatorId;

    await prisma.notification.create({
      data: {
        userId: otherUserId,
        type: 'DISPUTE_FILED',
        title: 'Dispute Filed',
        message: `A dispute has been filed for swap #${swap.id}`,
        link: `/swaps/${swap.id}`,
        data: { disputeId: dispute.id, swapId: swap.id },
      },
    });

    logger.info(`Dispute created: ${dispute.id} for swap ${disputeData.swapId}`);

    return dispute;
  }

  /**
   * Get user's disputes
   */
  async getUserDisputes(userId: string, pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where: {
          OR: [
            { reporterId: userId },
            {
              swap: {
                OR: [{ initiatorId: userId }, { receiverId: userId }],
              },
            },
          ],
        },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          reporter: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          swap: {
            include: {
              initiator: {
                select: { id: true, name: true },
              },
              receiver: {
                select: { id: true, name: true },
              },
            },
          },
          resolvedBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.dispute.count({
        where: {
          OR: [
            { reporterId: userId },
            {
              swap: {
                OR: [{ initiatorId: userId }, { receiverId: userId }],
              },
            },
          ],
        },
      }),
    ]);

    return {
      data: disputes,
      meta: { page, perPage, total },
    };
  }

  /**
   * Get dispute by ID
   */
  async getDisputeById(disputeId: string, userId: string) {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        reporter: {
          select: {
            id: true,
            name: true,
            email: true,
            rating: true,
          },
        },
        swap: {
          include: {
            initiator: {
              select: {
                id: true,
                name: true,
                email: true,
                rating: true,
              },
            },
            receiver: {
              select: {
                id: true,
                name: true,
                email: true,
                rating: true,
              },
            },
            offer: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute not found');
    }

    // Check if user has access to this dispute
    const hasAccess =
      dispute.reporterId === userId ||
      dispute.swap.initiatorId === userId ||
      dispute.swap.receiverId === userId;

    if (!hasAccess) {
      throw new ForbiddenError('You do not have access to this dispute');
    }

    return dispute;
  }

  /**
   * Update dispute (add evidence, update description)
   */
  async updateDispute(
    disputeId: string,
    userId: string,
    evidence?: string[],
    description?: string
  ) {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute not found');
    }

    if (dispute.reporterId !== userId) {
      throw new ForbiddenError('Only the reporter can update the dispute');
    }

    if (dispute.status === DisputeStatus.RESOLVED || dispute.status === DisputeStatus.CLOSED) {
      throw new BadRequestError('Cannot update a resolved or closed dispute');
    }

    const updateData: any = {};
    
    if (evidence) {
      updateData.evidence = [...dispute.evidence, ...evidence];
    }
    
    if (description) {
      updateData.description = description;
    }

    const updatedDispute = await prisma.dispute.update({
      where: { id: disputeId },
      data: updateData,
      include: {
        reporter: {
          select: { id: true, name: true },
        },
        swap: true,
      },
    });

    logger.info(`Dispute updated: ${disputeId} by user ${userId}`);

    return updatedDispute;
  }

  /**
   * Resolve dispute (staff/admin only)
   */
  async resolveDispute(
    disputeId: string,
    staffId: string,
    resolution: string,
    resolutionNote?: string
  ) {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        swap: {
          include: {
            initiator: true,
            receiver: true,
          },
        },
      },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute not found');
    }

    if (dispute.status === DisputeStatus.RESOLVED || dispute.status === DisputeStatus.CLOSED) {
      throw new BadRequestError('Dispute is already resolved or closed');
    }

    const resolvedDispute = await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.RESOLVED,
        resolution,
        resolutionNote,
        resolvedById: staffId,
        resolvedAt: new Date(),
      },
      include: {
        reporter: {
          select: { id: true, name: true },
        },
        swap: {
          include: {
            initiator: {
              select: { id: true, name: true },
            },
            receiver: {
              select: { id: true, name: true },
            },
          },
        },
        resolvedBy: {
          select: { id: true, name: true },
        },
      },
    });

    // Send notifications to both parties
    await Promise.all([
      prisma.notification.create({
        data: {
          userId: dispute.swap.initiatorId,
          type: 'DISPUTE_RESOLVED',
          title: 'Dispute Resolved',
          message: `The dispute for swap #${dispute.swapId} has been resolved`,
          link: `/disputes/${disputeId}`,
          data: { disputeId, resolution },
        },
      }),
      prisma.notification.create({
        data: {
          userId: dispute.swap.receiverId,
          type: 'DISPUTE_RESOLVED',
          title: 'Dispute Resolved',
          message: `The dispute for swap #${dispute.swapId} has been resolved`,
          link: `/disputes/${disputeId}`,
          data: { disputeId, resolution },
        },
      }),
    ]);

    logger.info(`Dispute resolved: ${disputeId} by staff ${staffId}`);

    return resolvedDispute;
  }

  /**
   * Escalate dispute to higher priority
   */
  async escalateDispute(disputeId: string, staffId: string) {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute not found');
    }

    if (dispute.status === DisputeStatus.RESOLVED || dispute.status === DisputeStatus.CLOSED) {
      throw new BadRequestError('Cannot escalate a resolved or closed dispute');
    }

    const escalatedDispute = await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.ESCALATED,
        priority: DisputePriority.URGENT,
      },
      include: {
        reporter: {
          select: { id: true, name: true },
        },
        swap: true,
      },
    });

    logger.info(`Dispute escalated: ${disputeId} by staff ${staffId}`);

    return escalatedDispute;
  }

  /**
   * Close dispute without resolution
   */
  async closeDispute(disputeId: string, staffId: string) {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        swap: true,
      },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute not found');
    }

    const closedDispute = await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.CLOSED,
        resolvedById: staffId,
        resolvedAt: new Date(),
      },
      include: {
        reporter: {
          select: { id: true, name: true },
        },
        swap: {
          include: {
            initiator: {
              select: { id: true, name: true },
            },
            receiver: {
              select: { id: true, name: true },
            },
          },
        },
        resolvedBy: {
          select: { id: true, name: true },
        },
      },
    });

    // Send notifications
    await Promise.all([
      prisma.notification.create({
        data: {
          userId: dispute.swap.initiatorId,
          type: 'DISPUTE_RESOLVED',
          title: 'Dispute Closed',
          message: `The dispute for swap #${dispute.swapId} has been closed`,
          link: `/disputes/${disputeId}`,
        },
      }),
      prisma.notification.create({
        data: {
          userId: dispute.swap.receiverId,
          type: 'DISPUTE_RESOLVED',
          title: 'Dispute Closed',
          message: `The dispute for swap #${dispute.swapId} has been closed`,
          link: `/disputes/${disputeId}`,
        },
      }),
    ]);

    logger.info(`Dispute closed: ${disputeId} by staff ${staffId}`);

    return closedDispute;
  }
}