import { PrismaClient } from '@prisma/client';
import { HelpersUtil } from '../src/utils/helpers.util';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create super admin
  const superAdmin = await prisma.user.create({
    data: {
      name: 'Super Admin',
      email: 'admin@currencyexchange.com',
      passwordHash: await HelpersUtil.hashPassword('Admin@123456'),
      role: 'SUPER_ADMIN',
      emailVerified: true,
      isActive: true,
    },
  });

  console.log('Created super admin:', superAdmin.email);

  // Create system configs
  const configs = [
    { key: 'max_swap_amount_unverified', value: '100', category: 'LIMITS', description: 'Maximum swap amount for unverified users' },
    { key: 'max_swap_amount_verified', value: '10000', category: 'LIMITS', description: 'Maximum swap amount for verified users' },
    { key: 'verification_fee', value: '5.00', category: 'PAYMENT', description: 'Verification fee amount' },
    { key: 'premium_monthly_price', value: '9.99', category: 'PAYMENT', description: 'Premium monthly subscription price' },
    { key: 'premium_yearly_price', value: '99.99', category: 'PAYMENT', description: 'Premium yearly subscription price' },
    { key: 'min_trust_score', value: '0', category: 'SECURITY', description: 'Minimum trust score to create offers' },
    { key: 'dispute_resolution_time_hours', value: '48', category: 'GENERAL', description: 'Time to resolve disputes' },
  ];

  for (const config of configs) {
    await prisma.systemConfig.create({ data: config });
  }

  console.log('Created system configs');

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