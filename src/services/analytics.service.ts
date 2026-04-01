// src/services/analytics.service.ts
import { prisma } from '@/config/database';
import { DateUtil } from '@/utils/date.util';
import { HelpersUtil } from '@/utils/helpers.util';
import logger from '@/utils/logger.util';
import {
  SwapStatus,
  TransactionStatus,
  TransactionType,
  DisputeStatus,
  UserRole,
} from '@prisma/client';

interface DateRange {
  start: Date;
  end: Date;
}

interface PeriodComparison {
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

interface DashboardStats {
  overview: {
    totalUsers: PeriodComparison;
    activeUsers: PeriodComparison;
    totalSwaps: PeriodComparison;
    completedSwaps: PeriodComparison;
    totalRevenue: PeriodComparison;
    averageSwapValue: PeriodComparison;
  };
  swaps: {
    byStatus: Record<SwapStatus, number>;
    completionRate: number;
    averageCompletionTime: number;
    totalValue: number;
  };
  users: {
    byRole: Record<UserRole, number>;
    verifiedUsers: number;
    premiumUsers: number;
    bannedUsers: number;
  };
  disputes: {
    total: number;
    open: number;
    resolved: number;
    resolutionRate: number;
  };
  recentActivity: {
    newUsers: number;
    newOffers: number;
    newSwaps: number;
    completedSwaps: number;
  };
}

interface UserAnalytics {
  registration: {
    total: number;
    byPeriod: Array<{ date: string; count: number }>;
    growthRate: number;
  };
  activity: {
    activeUsers: number;
    activeRate: number;
    averageSessionDuration: number;
    byCountry: Array<{ country: string; count: number }>;
    byCity: Array<{ city: string; count: number }>;
  };
  verification: {
    verified: number;
    unverified: number;
    verificationRate: number;
    idVerified: number;
    emailVerified: number;
    phoneVerified: number;
  };
  premium: {
    total: number;
    byTier: Record<string, number>;
    conversionRate: number;
    churnRate: number;
  };
  engagement: {
    averageSwapsPerUser: number;
    averageOffersPerUser: number;
    returnRate: number;
  };
}

interface SwapAnalytics {
  volume: {
    total: number;
    byPeriod: Array<{ date: string; count: number; value: number }>;
    byStatus: Record<SwapStatus, number>;
  };
  performance: {
    completionRate: number;
    cancellationRate: number;
    disputeRate: number;
    averageCompletionTime: number;
  };
  currency: {
    byCurrencyPair: Array<{
      pair: string;
      count: number;
      volume: number;
    }>;
    topCurrencies: Array<{ currency: string; count: number }>;
  };
  geography: {
    byCountry: Array<{ country: string; count: number }>;
    byCity: Array<{ city: string; count: number }>;
  };
  timing: {
    byHour: Array<{ hour: number; count: number }>;
    byDayOfWeek: Array<{ day: string; count: number }>;
  };
}

interface RevenueAnalytics {
  overview: {
    totalRevenue: number;
    byPeriod: Array<{ date: string; amount: number }>;
    growthRate: number;
  };
  bySource: {
    byType: Record<TransactionType, number>;
    topSources: Array<{ type: string; amount: number; percentage: number }>;
  };
  subscriptions: {
    totalRevenue: number;
    activeSubscriptions: number;
    mrr: number;
    arr: number;
    churnRate: number;
  };
  transactions: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    averageValue: number;
  };
}

interface GrowthAnalytics {
  users: {
    growth: Array<{ date: string; total: number; new: number }>;
    retentionRate: number;
    churnRate: number;
  };
  swaps: {
    growth: Array<{ date: string; total: number; new: number }>;
    growthRate: number;
  };
  revenue: {
    growth: Array<{ date: string; amount: number }>;
    growthRate: number;
  };
  engagement: {
    dau: number;
    mau: number;
    wau: number;
    stickinessRatio: number;
  };
}

export class AnalyticsService {
  /**
   * Get dashboard statistics
   */
  async getDashboardStats(): Promise<DashboardStats> {
    try {
      const currentPeriod = DateUtil.getDateRange('month');
      const previousPeriod = {
        start: DateUtil.subMonths(currentPeriod.start, 1),
        end: DateUtil.subMonths(currentPeriod.end, 1),
      };

      // Overview metrics
      const [
        totalUsers,
        previousTotalUsers,
        activeUsers,
        previousActiveUsers,
        totalSwaps,
        previousTotalSwaps,
        completedSwaps,
        previousCompletedSwaps,
        totalRevenue,
        previousTotalRevenue,
      ] = await Promise.all([
        this.getTotalUsers(currentPeriod),
        this.getTotalUsers(previousPeriod),
        this.getActiveUsers(currentPeriod),
        this.getActiveUsers(previousPeriod),
        this.getTotalSwaps(currentPeriod),
        this.getTotalSwaps(previousPeriod),
        this.getCompletedSwaps(currentPeriod),
        this.getCompletedSwaps(previousPeriod),
        this.getTotalRevenue(currentPeriod),
        this.getTotalRevenue(previousPeriod),
      ]);

      const currentAvgSwapValue = totalSwaps > 0 
        ? totalRevenue / totalSwaps 
        : 0;
      const previousAvgSwapValue = previousTotalSwaps > 0 
        ? previousTotalRevenue / previousTotalSwaps 
        : 0;

      // Swap statistics
      const [swapsByStatus, swapCompletionStats, swapTotalValue] = await Promise.all([
        this.getSwapsByStatus(),
        this.getSwapCompletionStats(),
        this.getSwapTotalValue(currentPeriod),
      ]);

      // User statistics
      const [usersByRole, verifiedCount, premiumCount, bannedCount] = await Promise.all([
        this.getUsersByRole(),
        this.getVerifiedUsersCount(),
        this.getPremiumUsersCount(),
        this.getBannedUsersCount(),
      ]);

      // Dispute statistics
      const disputeStats = await this.getDisputeStats();

      // Recent activity (last 24 hours)
      const recentActivity = await this.getRecentActivity();

      return {
        overview: {
          totalUsers: this.calculateComparison(totalUsers, previousTotalUsers),
          activeUsers: this.calculateComparison(activeUsers, previousActiveUsers),
          totalSwaps: this.calculateComparison(totalSwaps, previousTotalSwaps),
          completedSwaps: this.calculateComparison(completedSwaps, previousCompletedSwaps),
          totalRevenue: this.calculateComparison(totalRevenue, previousTotalRevenue),
          averageSwapValue: this.calculateComparison(currentAvgSwapValue, previousAvgSwapValue),
        },
        swaps: {
          byStatus: swapsByStatus,
          completionRate: swapCompletionStats.completionRate,
          averageCompletionTime: swapCompletionStats.averageCompletionTime,
          totalValue: swapTotalValue,
        },
        users: {
          byRole: usersByRole,
          verifiedUsers: verifiedCount,
          premiumUsers: premiumCount,
          bannedUsers: bannedCount,
        },
        disputes: disputeStats,
        recentActivity,
      };
    } catch (error) {
      logger.error('Error getting dashboard stats:', error);
      throw error;
    }
  }

  /**
   * Get user analytics
   */
  async getUserAnalytics(period: string = 'month'): Promise<UserAnalytics> {
    try {
      const dateRange = this.getDateRangeForPeriod(period);
      const previousRange = this.getPreviousPeriodRange(period);

      const [
        registrationData,
        activityData,
        verificationData,
        premiumData,
        engagementData,
      ] = await Promise.all([
        this.getUserRegistrationData(dateRange, previousRange),
        this.getUserActivityData(dateRange),
        this.getUserVerificationData(),
        this.getUserPremiumData(dateRange),
        this.getUserEngagementData(),
      ]);

      return {
        registration: registrationData,
        activity: activityData,
        verification: verificationData,
        premium: premiumData,
        engagement: engagementData,
      };
    } catch (error) {
      logger.error('Error getting user analytics:', error);
      throw error;
    }
  }

  /**
   * Get swap analytics
   */
  async getSwapAnalytics(period: string = 'month'): Promise<SwapAnalytics> {
    try {
      const dateRange = this.getDateRangeForPeriod(period);

      const [volumeData, performanceData, currencyData, geographyData, timingData] =
        await Promise.all([
          this.getSwapVolumeData(dateRange),
          this.getSwapPerformanceData(dateRange),
          this.getSwapCurrencyData(dateRange),
          this.getSwapGeographyData(dateRange),
          this.getSwapTimingData(dateRange),
        ]);

      return {
        volume: volumeData,
        performance: performanceData,
        currency: currencyData,
        geography: geographyData,
        timing: timingData,
      };
    } catch (error) {
      logger.error('Error getting swap analytics:', error);
      throw error;
    }
  }

  /**
   * Get revenue analytics
   */
  async getRevenueAnalytics(period: string = 'month'): Promise<RevenueAnalytics> {
    try {
      const dateRange = this.getDateRangeForPeriod(period);
      const previousRange = this.getPreviousPeriodRange(period);

      const [overviewData, sourceData, subscriptionData, transactionData] =
        await Promise.all([
          this.getRevenueOverviewData(dateRange, previousRange),
          this.getRevenueBySourceData(dateRange),
          this.getSubscriptionRevenueData(dateRange),
          this.getTransactionData(dateRange),
        ]);

      return {
        overview: overviewData,
        bySource: sourceData,
        subscriptions: subscriptionData,
        transactions: transactionData,
      };
    } catch (error) {
      logger.error('Error getting revenue analytics:', error);
      throw error;
    }
  }

  /**
   * Get growth analytics
   */
  async getGrowthAnalytics(period: string = 'month'): Promise<GrowthAnalytics> {
    try {
      const dateRange = this.getDateRangeForPeriod(period);

      const [userGrowth, swapGrowth, revenueGrowth, engagementMetrics] =
        await Promise.all([
          this.getUserGrowthData(dateRange),
          this.getSwapGrowthData(dateRange),
          this.getRevenueGrowthData(dateRange),
          this.getEngagementMetrics(),
        ]);

      return {
        users: userGrowth,
        swaps: swapGrowth,
        revenue: revenueGrowth,
        engagement: engagementMetrics,
      };
    } catch (error) {
      logger.error('Error getting growth analytics:', error);
      throw error;
    }
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  private async getTotalUsers(period: DateRange): Promise<number> {
    return prisma.user.count({
      where: {
        createdAt: {
          gte: period.start,
          lte: period.end,
        },
      },
    });
  }

  private async getActiveUsers(period: DateRange): Promise<number> {
    return prisma.user.count({
      where: {
        updatedAt: {
          gte: period.start,
          lte: period.end,
        },
        isActive: true,
      },
    });
  }

  private async getTotalSwaps(period: DateRange): Promise<number> {
    return prisma.swap.count({
      where: {
        createdAt: {
          gte: period.start,
          lte: period.end,
        },
      },
    });
  }

  private async getCompletedSwaps(period: DateRange): Promise<number> {
    return prisma.swap.count({
      where: {
        status: SwapStatus.COMPLETED,
        completedAt: {
          gte: period.start,
          lte: period.end,
        },
      },
    });
  }

  private async getTotalRevenue(period: DateRange): Promise<number> {
    const result = await prisma.transaction.aggregate({
      where: {
        status: TransactionStatus.COMPLETED,
        createdAt: {
          gte: period.start,
          lte: period.end,
        },
      },
      _sum: {
        platformFee: true,
      },
    });

    return Number(result._sum.platformFee || 0);
  }

  private async getSwapsByStatus(): Promise<Record<SwapStatus, number>> {
    const swaps = await prisma.swap.groupBy({
      by: ['status'],
      _count: true,
    });

    const result = {} as Record<SwapStatus, number>;
    Object.values(SwapStatus).forEach(status => {
      result[status] = 0;
    });

    swaps.forEach(swap => {
      result[swap.status] = swap._count;
    });

    return result;
  }

  private async getSwapCompletionStats(): Promise<{
    completionRate: number;
    averageCompletionTime: number;
  }> {
    const [total, completed] = await Promise.all([
      prisma.swap.count(),
      prisma.swap.count({ where: { status: SwapStatus.COMPLETED } }),
    ]);

    const completedSwaps = await prisma.swap.findMany({
      where: {
        status: SwapStatus.COMPLETED,
        completedAt: { not: null },
      },
      select: {
        createdAt: true,
        completedAt: true,
      },
    });

    let totalTime = 0;
    completedSwaps.forEach(swap => {
      if (swap.completedAt) {
        totalTime += DateUtil.diffInHours(swap.completedAt, swap.createdAt);
      }
    });

    const averageCompletionTime =
      completedSwaps.length > 0 ? totalTime / completedSwaps.length : 0;

    return {
      completionRate: total > 0 ? (completed / total) * 100 : 0,
      averageCompletionTime,
    };
  }

  private async getSwapTotalValue(period: DateRange): Promise<number> {
    const swaps = await prisma.swap.findMany({
      where: {
        createdAt: {
          gte: period.start,
          lte: period.end,
        },
        status: SwapStatus.COMPLETED,
      },
      select: {
        initiatorGivesAmount: true,
      },
    });

    return swaps.reduce((sum, swap) => sum + Number(swap.initiatorGivesAmount), 0);
  }

  private async getUsersByRole(): Promise<Record<UserRole, number>> {
    const users = await prisma.user.groupBy({
      by: ['role'],
      _count: true,
    });

    const result = {} as Record<UserRole, number>;
    Object.values(UserRole).forEach(role => {
      result[role] = 0;
    });

    users.forEach(user => {
      result[user.role] = user._count;
    });

    return result;
  }

  private async getVerifiedUsersCount(): Promise<number> {
    return prisma.user.count({
      where: { emailVerified: true },
    });
  }

  private async getPremiumUsersCount(): Promise<number> {
    return prisma.user.count({
      where: { isPremium: true },
    });
  }

  private async getBannedUsersCount(): Promise<number> {
    return prisma.user.count({
      where: { isBanned: true },
    });
  }

  private async getDisputeStats(): Promise<{
    total: number;
    open: number;
    resolved: number;
    resolutionRate: number;
  }> {
    const [total, open, resolved] = await Promise.all([
      prisma.dispute.count(),
      prisma.dispute.count({ where: { status: DisputeStatus.OPEN } }),
      prisma.dispute.count({ where: { status: DisputeStatus.RESOLVED } }),
    ]);

    return {
      total,
      open,
      resolved,
      resolutionRate: total > 0 ? (resolved / total) * 100 : 0,
    };
  }

  private async getRecentActivity(): Promise<{
    newUsers: number;
    newOffers: number;
    newSwaps: number;
    completedSwaps: number;
  }> {
    const last24Hours = DateUtil.subHours(new Date(), 24);

    const [newUsers, newOffers, newSwaps, completedSwaps] = await Promise.all([
      prisma.user.count({
        where: { createdAt: { gte: last24Hours } },
      }),
      prisma.swapOffer.count({
        where: { createdAt: { gte: last24Hours } },
      }),
      prisma.swap.count({
        where: { createdAt: { gte: last24Hours } },
      }),
      prisma.swap.count({
        where: {
          status: SwapStatus.COMPLETED,
          completedAt: { gte: last24Hours },
        },
      }),
    ]);

    return {
      newUsers,
      newOffers,
      newSwaps,
      completedSwaps,
    };
  }

  private calculateComparison(
    current: number,
    previous: number
  ): PeriodComparison {
    const change = current - previous;
    const changePercent =
      previous > 0 ? HelpersUtil.calculatePercentageChange(previous, current) : 0;

    return {
      current,
      previous,
      change,
      changePercent: HelpersUtil.roundTo(changePercent, 2),
    };
  }

  private getDateRangeForPeriod(period: string): DateRange {
    switch (period) {
      case 'today':
        return DateUtil.getDateRange('today');
      case 'yesterday':
        return DateUtil.getDateRange('yesterday');
      case 'week':
        return DateUtil.getDateRange('week');
      case 'month':
        return DateUtil.getDateRange('month');
      case 'year':
        return DateUtil.getDateRange('year');
      default:
        return DateUtil.getDateRange('month');
    }
  }

  private getPreviousPeriodRange(period: string): DateRange {
    const current = this.getDateRangeForPeriod(period);
    const duration = DateUtil.diffInDays(current.end, current.start);

    return {
      start: DateUtil.subDays(current.start, duration + 1),
      end: DateUtil.subDays(current.end, duration + 1),
    };
  }

  private async getUserRegistrationData(
    current: DateRange,
    previous: DateRange
  ): Promise<{
    total: number;
    byPeriod: Array<{ date: string; count: number }>;
    growthRate: number;
  }> {
    const [currentTotal, previousTotal] = await Promise.all([
      prisma.user.count({
        where: {
          createdAt: { gte: current.start, lte: current.end },
        },
      }),
      prisma.user.count({
        where: {
          createdAt: { gte: previous.start, lte: previous.end },
        },
      }),
    ]);

    // Get users and group by date manually
    const users = await prisma.user.findMany({
      where: {
        createdAt: { gte: current.start, lte: current.end },
      },
      select: {
        createdAt: true,
      },
    });

    const dateMap = new Map<string, number>();
    users.forEach(user => {
      const date = DateUtil.format(user.createdAt, 'yyyy-MM-dd');
      dateMap.set(date, (dateMap.get(date) || 0) + 1);
    });

    const byPeriod = Array.from(dateMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const growthRate = HelpersUtil.calculatePercentageChange(
      previousTotal,
      currentTotal
    );

    return {
      total: currentTotal,
      byPeriod,
      growthRate: HelpersUtil.roundTo(growthRate, 2),
    };
  }

  private async getUserActivityData(period: DateRange): Promise<{
    activeUsers: number;
    activeRate: number;
    averageSessionDuration: number;
    byCountry: Array<{ country: string; count: number }>;
    byCity: Array<{ city: string; count: number }>;
  }> {
    const [totalUsers, activeUsers, byCountry, byCity] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: {
          updatedAt: { gte: period.start, lte: period.end },
          isActive: true,
        },
      }),
      prisma.user.groupBy({
        by: ['country'],
        where: {
          country: { not: null },
        },
        _count: true,
        orderBy: {
          _count: {
            country: 'desc',
          },
        },
        take: 10,
      }),
      prisma.user.groupBy({
        by: ['city'],
        where: {
          city: { not: null },
        },
        _count: true,
        orderBy: {
          _count: {
            city: 'desc',
          },
        },
        take: 10,
      }),
    ]);

    return {
      activeUsers,
      activeRate: totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0,
      averageSessionDuration: 0, // Can be calculated from session data
      byCountry: byCountry.map(item => ({
        country: item.country || 'Unknown',
        count: item._count,
      })),
      byCity: byCity.map(item => ({
        city: item.city || 'Unknown',
        count: item._count,
      })),
    };
  }

  private async getUserVerificationData(): Promise<{
    verified: number;
    unverified: number;
    verificationRate: number;
    idVerified: number;
    emailVerified: number;
    phoneVerified: number;
  }> {
    const [total, emailVerified, phoneVerified, idVerified] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { emailVerified: true } }),
      prisma.user.count({ where: { phoneVerified: true } }),
      prisma.user.count({ where: { idVerified: true } }),
    ]);

    return {
      verified: emailVerified,
      unverified: total - emailVerified,
      verificationRate: total > 0 ? (emailVerified / total) * 100 : 0,
      idVerified,
      emailVerified,
      phoneVerified,
    };
  }

  private async getUserPremiumData(_period: DateRange): Promise<{
    total: number;
    byTier: Record<string, number>;
    conversionRate: number;
    churnRate: number;
  }> {
    const [totalUsers, premiumUsers, byTier] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isPremium: true } }),
      prisma.user.groupBy({
        by: ['premiumTier'],
        where: {
          isPremium: true,
          premiumTier: { not: null },
        },
        _count: true,
      }),
    ]);

    const tierCounts: Record<string, number> = {};
    byTier.forEach(item => {
      if (item.premiumTier) {
        tierCounts[item.premiumTier] = item._count;
      }
    });

    return {
      total: premiumUsers,
      byTier: tierCounts,
      conversionRate: totalUsers > 0 ? (premiumUsers / totalUsers) * 100 : 0,
      churnRate: 0, // Calculate based on expired subscriptions
    };
  }

  private async getUserEngagementData(): Promise<{
    averageSwapsPerUser: number;
    averageOffersPerUser: number;
    returnRate: number;
  }> {
    const [totalUsers, totalSwaps, totalOffers] = await Promise.all([
      prisma.user.count(),
      prisma.swap.count(),
      prisma.swapOffer.count(),
    ]);

    return {
      averageSwapsPerUser: totalUsers > 0 ? totalSwaps / totalUsers : 0,
      averageOffersPerUser: totalUsers > 0 ? totalOffers / totalUsers : 0,
      returnRate: 0, // Calculate based on user activity patterns
    };
  }

  private async getSwapVolumeData(period: DateRange): Promise<{
    total: number;
    byPeriod: Array<{ date: string; count: number; value: number }>;
    byStatus: Record<SwapStatus, number>;
  }> {
    const [total, swaps, byStatus] = await Promise.all([
      prisma.swap.count({
        where: {
          createdAt: { gte: period.start, lte: period.end },
        },
      }),
      prisma.swap.findMany({
        where: {
          createdAt: { gte: period.start, lte: period.end },
        },
        select: {
          createdAt: true,
          initiatorGivesAmount: true,
        },
      }),
      this.getSwapsByStatus(),
    ]);

    // Group by date manually
    const dateMap = new Map<string, { count: number; value: number }>();
    swaps.forEach(swap => {
      const date = DateUtil.format(swap.createdAt, 'yyyy-MM-dd');
      const existing = dateMap.get(date) || { count: 0, value: 0 };
      dateMap.set(date, {
        count: existing.count + 1,
        value: existing.value + Number(swap.initiatorGivesAmount),
      });
    });

    const byPeriod = Array.from(dateMap.entries())
      .map(([date, data]) => ({
        date,
        count: data.count,
        value: data.value,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      total,
      byPeriod,
      byStatus,
    };
  }

  private async getSwapPerformanceData(period: DateRange): Promise<{
    completionRate: number;
    cancellationRate: number;
    disputeRate: number;
    averageCompletionTime: number;
  }> {
    const [total, completed, cancelled, disputed] = await Promise.all([
      prisma.swap.count({
        where: {
          createdAt: { gte: period.start, lte: period.end },
        },
      }),
      prisma.swap.count({
        where: {
          status: SwapStatus.COMPLETED,
          createdAt: { gte: period.start, lte: period.end },
        },
      }),
      prisma.swap.count({
        where: {
          status: SwapStatus.CANCELLED,
          createdAt: { gte: period.start, lte: period.end },
        },
      }),
      prisma.swap.count({
        where: {
          status: SwapStatus.DISPUTED,
          createdAt: { gte: period.start, lte: period.end },
        },
      }),
    ]);

    const completedSwaps = await prisma.swap.findMany({
      where: {
        status: SwapStatus.COMPLETED,
        completedAt: { not: null },
        createdAt: { gte: period.start, lte: period.end },
      },
      select: {
        createdAt: true,
        completedAt: true,
      },
    });

    let totalTime = 0;
    completedSwaps.forEach(swap => {
      if (swap.completedAt) {
        totalTime += DateUtil.diffInHours(swap.completedAt, swap.createdAt);
      }
    });

    return {
      completionRate: total > 0 ? (completed / total) * 100 : 0,
      cancellationRate: total > 0 ? (cancelled / total) * 100 : 0,
      disputeRate: total > 0 ? (disputed / total) * 100 : 0,
      averageCompletionTime:
        completedSwaps.length > 0 ? totalTime / completedSwaps.length : 0,
    };
  }

  private async getSwapCurrencyData(period: DateRange): Promise<{
    byCurrencyPair: Array<{ pair: string; count: number; volume: number }>;
    topCurrencies: Array<{ currency: string; count: number }>;
  }> {
    const swaps = await prisma.swap.findMany({
      where: {
        createdAt: { gte: period.start, lte: period.end },
      },
      select: {
        initiatorGivesCurrency: true,
        receiverGivesCurrency: true,
        initiatorGivesAmount: true,
      },
    });

    const pairMap = new Map<string, { count: number; volume: number }>();
    const currencyMap = new Map<string, number>();

    swaps.forEach(swap => {
      const pair = `${swap.initiatorGivesCurrency}/${swap.receiverGivesCurrency}`;
      const existing = pairMap.get(pair) || { count: 0, volume: 0 };
      pairMap.set(pair, {
        count: existing.count + 1,
        volume: existing.volume + Number(swap.initiatorGivesAmount),
      });

      currencyMap.set(
        swap.initiatorGivesCurrency,
        (currencyMap.get(swap.initiatorGivesCurrency) || 0) + 1
      );
      currencyMap.set(
        swap.receiverGivesCurrency,
        (currencyMap.get(swap.receiverGivesCurrency) || 0) + 1
      );
    });

    const byCurrencyPair = Array.from(pairMap.entries())
      .map(([pair, data]) => ({
        pair,
        count: data.count,
        volume: data.volume,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topCurrencies = Array.from(currencyMap.entries())
      .map(([currency, count]) => ({ currency, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      byCurrencyPair,
      topCurrencies,
    };
  }

  private async getSwapGeographyData(period: DateRange): Promise<{
    byCountry: Array<{ country: string; count: number }>;
    byCity: Array<{ city: string; count: number }>;
  }> {
    const swaps = await prisma.swap.findMany({
      where: {
        createdAt: { gte: period.start, lte: period.end },
      },
      include: {
        offer: {
          select: {
            country: true,
            city: true,
          },
        },
      },
    });

    const countryMap = new Map<string, number>();
    const cityMap = new Map<string, number>();

    swaps.forEach(swap => {
      if (swap.offer.country) {
        countryMap.set(
          swap.offer.country,
          (countryMap.get(swap.offer.country) || 0) + 1
        );
      }
      if (swap.offer.city) {
        cityMap.set(swap.offer.city, (cityMap.get(swap.offer.city) || 0) + 1);
      }
    });

    const byCountry = Array.from(countryMap.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const byCity = Array.from(cityMap.entries())
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      byCountry,
      byCity,
    };
  }

  private async getSwapTimingData(period: DateRange): Promise<{
    byHour: Array<{ hour: number; count: number }>;
    byDayOfWeek: Array<{ day: string; count: number }>;
  }> {
    const swaps = await prisma.swap.findMany({
      where: {
        createdAt: { gte: period.start, lte: period.end },
      },
      select: {
        createdAt: true,
      },
    });

    const hourMap = new Map<number, number>();
    const dayMap = new Map<number, number>();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    swaps.forEach(swap => {
      const hour = swap.createdAt.getHours();
      const day = swap.createdAt.getDay();

      hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    });

    const byHour = Array.from(hourMap.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour);

    const byDayOfWeek = Array.from(dayMap.entries())
      .map(([day, count]) => ({ day: dayNames[day], count }))
      .sort((a, b) => dayNames.indexOf(a.day) - dayNames.indexOf(b.day));

    return {
      byHour,
      byDayOfWeek,
    };
  }

  private async getRevenueOverviewData(
    current: DateRange,
    previous: DateRange
  ): Promise<{
    totalRevenue: number;
    byPeriod: Array<{ date: string; amount: number }>;
    growthRate: number;
  }> {
    const [currentRevenue, previousRevenue, transactions] = await Promise.all([
      this.getTotalRevenue(current),
      this.getTotalRevenue(previous),
      prisma.transaction.findMany({
        where: {
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: current.start, lte: current.end },
        },
        select: {
          createdAt: true,
          platformFee: true,
        },
      }),
    ]);

    // Group by date manually
    const dateMap = new Map<string, number>();
    transactions.forEach(tx => {
      const date = DateUtil.format(tx.createdAt, 'yyyy-MM-dd');
      dateMap.set(date, (dateMap.get(date) || 0) + Number(tx.platformFee || 0));
    });

    const byPeriod = Array.from(dateMap.entries())
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const growthRate = HelpersUtil.calculatePercentageChange(
      previousRevenue,
      currentRevenue
    );

    return {
      totalRevenue: currentRevenue,
      byPeriod,
      growthRate: HelpersUtil.roundTo(growthRate, 2),
    };
  }

  private async getRevenueBySourceData(period: DateRange): Promise<{
    byType: Record<TransactionType, number>;
    topSources: Array<{ type: string; amount: number; percentage: number }>;
  }> {
    const transactions = await prisma.transaction.groupBy({
      by: ['type'],
      where: {
        status: TransactionStatus.COMPLETED,
        createdAt: { gte: period.start, lte: period.end },
      },
      _sum: {
        platformFee: true,
      },
    });

    const byType = {} as Record<TransactionType, number>;
    let totalRevenue = 0;

    transactions.forEach(tx => {
      const amount = Number(tx._sum.platformFee || 0);
      byType[tx.type] = amount;
      totalRevenue += amount;
    });

    const topSources = transactions
      .map(tx => ({
        type: tx.type,
        amount: Number(tx._sum.platformFee || 0),
        percentage:
          totalRevenue > 0
            ? (Number(tx._sum.platformFee || 0) / totalRevenue) * 100
            : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      byType,
      topSources,
    };
  }

  private async getSubscriptionRevenueData(period: DateRange): Promise<{
    totalRevenue: number;
    activeSubscriptions: number;
    mrr: number;
    arr: number;
    churnRate: number;
  }> {
    const [subscriptionRevenue, activeSubscriptions] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          type: TransactionType.PREMIUM_SUBSCRIPTION,
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: period.start, lte: period.end },
        },
        _sum: {
          amount: true,
        },
      }),
      prisma.user.count({
        where: {
          isPremium: true,
          premiumExpiry: { gt: new Date() },
        },
      }),
    ]);

    const totalRevenue = Number(subscriptionRevenue._sum.amount || 0);
    const mrr = totalRevenue / DateUtil.diffInDays(period.end, period.start) * 30;
    const arr = mrr * 12;

    return {
      totalRevenue,
      activeSubscriptions,
      mrr: HelpersUtil.roundTo(mrr, 2),
      arr: HelpersUtil.roundTo(arr, 2),
      churnRate: 0, // Calculate based on subscription cancellations
    };
  }

  private async getTransactionData(period: DateRange): Promise<{
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    averageValue: number;
  }> {
    const [total, successful, failed, avgValue] = await Promise.all([
      prisma.transaction.count({
        where: {
          createdAt: { gte: period.start, lte: period.end },
        },
      }),
      prisma.transaction.count({
        where: {
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: period.start, lte: period.end },
        },
      }),
      prisma.transaction.count({
        where: {
          status: TransactionStatus.FAILED,
          createdAt: { gte: period.start, lte: period.end },
        },
      }),
      prisma.transaction.aggregate({
        where: {
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: period.start, lte: period.end },
        },
        _avg: {
          amount: true,
        },
      }),
    ]);

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      averageValue: Number(avgValue._avg.amount || 0),
    };
  }

  private async getUserGrowthData(period: DateRange): Promise<{
    growth: Array<{ date: string; total: number; new: number }>;
    retentionRate: number;
    churnRate: number;
  }> {
    const users = await prisma.user.findMany({
      where: {
        createdAt: { gte: period.start, lte: period.end },
      },
      select: {
        createdAt: true,
      },
    });

    // Group by date manually
    const dateMap = new Map<string, number>();
    users.forEach(user => {
      const date = DateUtil.format(user.createdAt, 'yyyy-MM-dd');
      dateMap.set(date, (dateMap.get(date) || 0) + 1);
    });

    let runningTotal = await prisma.user.count({
      where: {
        createdAt: { lt: period.start },
      },
    });

    const growth = Array.from(dateMap.entries())
      .map(([date, newUsers]) => {
        runningTotal += newUsers;
        return {
          date,
          total: runningTotal,
          new: newUsers,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      growth,
      retentionRate: 0, // Calculate based on active users over time
      churnRate: 0, // Calculate based on inactive users
    };
  }

  private async getSwapGrowthData(period: DateRange): Promise<{
    growth: Array<{ date: string; total: number; new: number }>;
    growthRate: number;
  }> {
    const swaps = await prisma.swap.findMany({
      where: {
        createdAt: { gte: period.start, lte: period.end },
      },
      select: {
        createdAt: true,
      },
    });

    // Group by date manually
    const dateMap = new Map<string, number>();
    swaps.forEach(swap => {
      const date = DateUtil.format(swap.createdAt, 'yyyy-MM-dd');
      dateMap.set(date, (dateMap.get(date) || 0) + 1);
    });

    let runningTotal = await prisma.swap.count({
      where: {
        createdAt: { lt: period.start },
      },
    });

    const growth = Array.from(dateMap.entries())
      .map(([date, newSwaps]) => {
        runningTotal += newSwaps;
        return {
          date,
          total: runningTotal,
          new: newSwaps,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const growthRate =
      growth.length > 1
        ? HelpersUtil.calculatePercentageChange(
            growth[0].total,
            growth[growth.length - 1].total
          )
        : 0;

    return {
      growth,
      growthRate: HelpersUtil.roundTo(growthRate, 2),
    };
  }

  private async getRevenueGrowthData(period: DateRange): Promise<{
    growth: Array<{ date: string; amount: number }>;
    growthRate: number;
  }> {
    const transactions = await prisma.transaction.findMany({
      where: {
        status: TransactionStatus.COMPLETED,
        createdAt: { gte: period.start, lte: period.end },
      },
      select: {
        createdAt: true,
        platformFee: true,
      },
    });

    // Group by date manually
    const dateMap = new Map<string, number>();
    transactions.forEach(tx => {
      const date = DateUtil.format(tx.createdAt, 'yyyy-MM-dd');
      dateMap.set(date, (dateMap.get(date) || 0) + Number(tx.platformFee || 0));
    });

    const growth = Array.from(dateMap.entries())
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const growthRate =
      growth.length > 1
        ? HelpersUtil.calculatePercentageChange(
            growth[0].amount,
            growth[growth.length - 1].amount
          )
        : 0;

    return {
      growth,
      growthRate: HelpersUtil.roundTo(growthRate, 2),
    };
  }

  private async getEngagementMetrics(): Promise<{
    dau: number;
    mau: number;
    wau: number;
    stickinessRatio: number;
  }> {
    const now = new Date();
    const [dau, wau, mau] = await Promise.all([
      prisma.user.count({
        where: {
          updatedAt: { gte: DateUtil.subDays(now, 1) },
          isActive: true,
        },
      }),
      prisma.user.count({
        where: {
          updatedAt: { gte: DateUtil.subDays(now, 7) },
          isActive: true,
        },
      }),
      prisma.user.count({
        where: {
          updatedAt: { gte: DateUtil.subDays(now, 30) },
          isActive: true,
        },
      }),
    ]);

    const stickinessRatio = mau > 0 ? (dau / mau) * 100 : 0;

    return {
      dau,
      mau,
      wau,
      stickinessRatio: HelpersUtil.roundTo(stickinessRatio, 2),
    };
  }

  /**
   * Record analytics event
   */
  async recordAnalyticsEvent(
    metric: string,
    value: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      await prisma.analytics.create({
        data: {
          metric,
          value,
          metadata: metadata || {},
        },
      });
    } catch (error) {
      logger.error('Error recording analytics event:', error);
    }
  }
}

export default AnalyticsService;