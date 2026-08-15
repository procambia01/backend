import { PrismaClient } from '@prisma/client';
import { HelpersUtil } from '@/utils/helpers.util';
import { config } from '@/config/env';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  if (!config.admin.email || !config.admin.password) {
    throw new Error(
      'SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in your environment before seeding. ' +
        'See .env.example.'
    );
  }

  // upsert, not create — a seed script needs to be safe to re-run.
  // With create(), running this a second time crashes on the unique
  // `email` constraint the moment an admin already exists.
  const superAdmin = await prisma.user.upsert({
    where: { email: config.admin.email },
    update: {},
    create: {
      name: 'Super Admin',
      email: config.admin.email,
      passwordHash: await HelpersUtil.hashPassword(config.admin.password),
      role: 'SUPER_ADMIN',
      emailVerified: true,
      isActive: true,
    },
  });

  console.log('Super admin ready:', superAdmin.email);

  // Create system configs
  const configs = [
    {
      key: 'max_swap_amount_unverified',
      value: '100',
      category: 'LIMITS',
      description: 'Maximum swap amount for unverified users',
    },
    {
      key: 'max_swap_amount_verified',
      value: '10000',
      category: 'LIMITS',
      description: 'Maximum swap amount for verified users',
    },
    {
      key: 'verification_fee',
      value: '5.00',
      category: 'PAYMENT',
      description: 'Verification fee amount',
    },
    {
      key: 'premium_monthly_price',
      value: '9.99',
      category: 'PAYMENT',
      description: 'Premium monthly subscription price',
    },
    {
      key: 'premium_yearly_price',
      value: '99.99',
      category: 'PAYMENT',
      description: 'Premium yearly subscription price',
    },
    {
      key: 'min_trust_score',
      value: '0',
      category: 'SECURITY',
      description: 'Minimum trust score to create offers',
    },
    {
      key: 'dispute_resolution_time_hours',
      value: '48',
      category: 'GENERAL',
      description: 'Time to resolve disputes',
    },
  ];

  for (const cfg of configs) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: { value: cfg.value, category: cfg.category, description: cfg.description },
      create: cfg,
    });
  }

  console.log('System configs ready');

  // Add some sample currencies
  const currencies = ['USD', 'EUR', 'GBP', 'NGN', 'GHS', 'KES', 'ZAR'];
  console.log('Supported currencies:', currencies.join(', '));

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
