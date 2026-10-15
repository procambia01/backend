/**
 * Idempotent seed. Creates *defaults only*: anything an admin has already
 * changed (currency flags, prices, limits, config values) is left untouched.
 * Run with:  npm run prisma:seed
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { CURRENCY_SEED } from '../src/lib/currency-catalog';
import { DEFAULT_LIMIT_POLICIES } from '../src/services/limit.service';
import { CONFIG_DEFAULTS } from '../src/services/system-config.service';
import { HelpersUtil } from '../src/utils/helpers.util';
import { config } from '../src/config/env';

const prisma = new PrismaClient();

const PRODUCTS: Prisma.ServiceProductCreateInput[] = [
  { code: 'PREMIUM_MONTHLY', kind: 'PREMIUM_PLAN', name: 'Premium (monthly)', description: 'Unlimited offers, advanced search, priority matching, rate alerts and analytics.', amountMinor: 999, currency: 'EUR', interval: 'MONTH', planTier: 'PREMIUM', features: ['Unlimited active offers', 'Advanced search', 'Priority matching', 'Rate alerts', 'Advanced analytics', 'Premium badge'], sortOrder: 10 },
  { code: 'PREMIUM_YEARLY', kind: 'PREMIUM_PLAN', name: 'Premium (yearly)', description: 'Premium, billed yearly.', amountMinor: 9900, currency: 'EUR', interval: 'YEAR', planTier: 'PREMIUM', features: ['Everything in Premium', '2 months free'], sortOrder: 11 },
  { code: 'BUSINESS_MONTHLY', kind: 'BUSINESS_PLAN', name: 'Business (monthly)', description: 'Verified business profile, team members, higher limits, API access and reporting.', amountMinor: 3999, currency: 'EUR', interval: 'MONTH', planTier: 'BUSINESS', features: ['Business profile', 'Team members', 'Higher limits', 'API access', 'Business analytics', 'Priority support'], sortOrder: 20 },
  { code: 'BUSINESS_YEARLY', kind: 'BUSINESS_PLAN', name: 'Business (yearly)', description: 'Business, billed yearly.', amountMinor: 39900, currency: 'EUR', interval: 'YEAR', planTier: 'BUSINESS', features: ['Everything in Business', '2 months free'], sortOrder: 21 },
  { code: 'API_STARTER', kind: 'API_PLAN', name: 'API Starter', description: 'Programmatic access to rates and public market data.', amountMinor: 1999, currency: 'EUR', interval: 'MONTH', features: ['60 requests / minute', '50,000 requests / month'], config: { rateLimitPerMinute: 60, monthlyQuota: 50000 }, sortOrder: 30 },
  { code: 'BOOST_24H', kind: 'BOOST', name: 'Boost – 24 hours', description: 'Rank higher in search for 24 hours.', amountMinor: 199, currency: 'EUR', durationHours: 24, sortOrder: 40 },
  { code: 'BOOST_3D', kind: 'BOOST', name: 'Boost – 3 days', description: 'Rank higher in search for 3 days.', amountMinor: 499, currency: 'EUR', durationHours: 72, sortOrder: 41 },
  { code: 'BOOST_7D', kind: 'BOOST', name: 'Boost – 7 days', description: 'Rank higher in search for 7 days.', amountMinor: 899, currency: 'EUR', durationHours: 168, sortOrder: 42 },
  { code: 'FEATURED_HOME_3D', kind: 'FEATURED', name: 'Featured on homepage – 3 days', description: 'A labelled placement on the CashMouver homepage.', amountMinor: 999, currency: 'EUR', durationHours: 72, placement: 'HOMEPAGE', sortOrder: 50 },
  { code: 'FEATURED_MARKET_7D', kind: 'FEATURED', name: 'Featured in marketplace – 7 days', description: 'A labelled placement at the top of the marketplace.', amountMinor: 1499, currency: 'EUR', durationHours: 168, placement: 'MARKETPLACE_TOP', sortOrder: 51 },
  { code: 'VERIFICATION_ENHANCED', kind: 'VERIFICATION', name: 'Enhanced verification', description: 'Priority identity review for higher trading limits.', amountMinor: 1499, currency: 'EUR', interval: 'ONE_TIME', sortOrder: 60 },
  { code: 'AD_SPONSORED_7D', kind: 'ADVERTISING', name: 'Sponsored placement – 7 days', description: 'A clearly labelled sponsored placement.', amountMinor: 2999, currency: 'EUR', durationHours: 168, sortOrder: 70 },
  { code: 'AD_SPONSORED_30D', kind: 'ADVERTISING', name: 'Sponsored placement – 30 days', description: 'A clearly labelled sponsored placement.', amountMinor: 9999, currency: 'EUR', durationHours: 720, sortOrder: 71 },
];

const REFERRAL_RULES: Prisma.ReferralRuleCreateInput[] = [
  { code: 'FIRST_SWAP', name: 'Referred user completes a first swap', qualifyingAction: 'FIRST_COMPLETED_SWAP', minCompletedSwaps: 1, rewardType: 'FIXED', rewardMinor: 300, currency: 'EUR', holdDays: 7 },
  { code: 'PAID_PLAN', name: 'Referred user buys a paid plan', qualifyingAction: 'PAID_PLAN_PURCHASE', rewardType: 'PERCENT_OF_SERVICE_REVENUE', percentBps: 1500, currency: 'EUR', holdDays: 14 },
  { code: 'PARTNER_PAID_PLAN', name: 'Partner: referred user buys a paid plan', qualifyingAction: 'PAID_PLAN_PURCHASE', rewardType: 'PERCENT_OF_SERVICE_REVENUE', percentBps: 2500, currency: 'EUR', isPartnerRule: true, holdDays: 14, monthlyCapPerReferrer: 200, lifetimeCapPerReferrer: 5000 },
];

async function main() {
  console.log('Seeding CashMouver…');

  for (const [i, c] of CURRENCY_SEED.entries()) {
    const exists = await prisma.currency.findUnique({ where: { code: c.code } });
    if (!exists) await prisma.currency.create({ data: { code: c.code, name: c.name, symbol: c.symbol, minorUnit: c.minorUnit, region: c.region, isPopular: !!c.isPopular, isActive: true, sortOrder: c.isPopular ? i : 1000 + i } });
  }

  for (const p of DEFAULT_LIMIT_POLICIES) {
    const exists = await prisma.limitPolicy.findUnique({ where: { key: p.key } });
    if (!exists) await prisma.limitPolicy.create({ data: p });
  }

  for (const p of PRODUCTS) {
    const exists = await prisma.serviceProduct.findUnique({ where: { code: p.code } });
    if (!exists) await prisma.serviceProduct.create({ data: p });
  }

  for (const r of REFERRAL_RULES) {
    const exists = await prisma.referralRule.findUnique({ where: { code: r.code } });
    if (!exists) await prisma.referralRule.create({ data: r });
  }

  for (const [key, d] of Object.entries(CONFIG_DEFAULTS)) {
    const exists = await prisma.systemConfig.findUnique({ where: { key } });
    if (!exists) await prisma.systemConfig.create({ data: { key, value: d.value, dataType: d.dataType, description: d.description, category: d.category, isPublic: !!d.isPublic } });
  }

  if (config.admin.email && config.admin.password) {
    const email = config.admin.email.toLowerCase();
    const exists = await prisma.user.findUnique({ where: { email } });
    if (!exists) {
      await prisma.user.create({
        data: { name: 'CashMouver Admin', email, passwordHash: await HelpersUtil.hashPassword(config.admin.password), role: 'SUPER_ADMIN', emailVerified: true, isActive: true },
      });
      console.log(`Super admin created: ${email}`);
    }
  } else {
    console.log('SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set: skipped admin bootstrap.');
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
