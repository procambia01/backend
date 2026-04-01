// src/cron/premiumExpiry.cron.ts
import { prisma } from '@/config/database';
import logger from '@/utils/logger.util';

export async function runPremiumExpiryCron() {
  logger.info('[Cron] Checking premium expirations…');
  const now = new Date();

  // Expire overdue premium memberships
  const expired = await prisma.user.updateMany({
    where: { isPremium: true, premiumExpiry: { lt: now } },
    data:  { isPremium: false, premiumTier: null, premiumExpiry: null },
  });

  if (expired.count > 0) {
    logger.info(`[Cron] Expired ${expired.count} premium memberships`);
  }

  // Notify users expiring in next 3 days
  const soonExpiring = await prisma.user.findMany({
    where: {
      isPremium: true,
      premiumExpiry: {
        gt: now,
        lt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
    },
    select: { id: true },
  });

  for (const user of soonExpiring) {
    await prisma.notification.create({
      data: {
        userId:  user.id,
        type:    'PREMIUM_EXPIRING',
        title:   'Premium expiring soon',
        message: 'Your premium membership expires in less than 3 days.',
      },
    });
  }

  logger.info(`[Cron] Notified ${soonExpiring.length} users about expiring premium`);
}

// ─────────────────────────────────────────────────────────

// src/cron/analytics.cron.ts
export async function runAnalyticsCron() {
  logger.info('[Cron] Running daily analytics snapshot…');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalUsers, activeUsers, totalSwaps, completedSwaps] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.swap.count(),
    prisma.swap.count({ where: { status: 'COMPLETED' } }),
  ]);

  const metrics: Array<{ metric: string; value: number }> = [
    { metric: 'total_users',      value: totalUsers      },
    { metric: 'active_users',     value: activeUsers     },
    { metric: 'total_swaps',      value: totalSwaps      },
    { metric: 'completed_swaps',  value: completedSwaps  },
  ];

  await Promise.all(
    metrics.map(m =>
      prisma.analytics.create({ data: { date: today, metric: m.metric, value: m.value } }),
    ),
  );

  logger.info('[Cron] Analytics snapshot saved');
}
