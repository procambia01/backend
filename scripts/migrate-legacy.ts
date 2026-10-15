/**
 * One-off migration from the legacy CashMova data model to CashMouver.
 *
 *   npx tsx scripts/migrate-legacy.ts            # dry run (default): counts only, writes nothing
 *   npx tsx scripts/migrate-legacy.ts --apply    # perform the migration
 *
 * BACK UP THE DATABASE FIRST. The script is idempotent (it only touches
 * documents that still carry legacy fields) but it has not been run against
 * production data. Review the dry-run output before applying.
 *
 * What it does
 *   • SwapOffer  : Float amounts → BigInt minor units, rate → rateScaled (1e10), lat/lng → GeoJSON
 *                  `area` (coarse, jittered) + `privateLocation` (exact), MATCHED → ACTIVE,
 *                  legacy fields removed.
 *   • Swap       : Float terms → minor units, EXPIRED/FAILED → CANCELLED (with a cancel code),
 *                  security-deposit and platform-fee fields removed. Offer owner's currency is the
 *                  swap's "have" side.
 *   • OfferReservation rows are created for every non-terminal / completed swap and offer counters
 *                  are rebuilt so that remaining + reserved + consumed == total.
 *   • User       : isPremium/premiumTier/premiumExpiry → planTier/planExpiresAt (time-boxed, no Stripe link).
 *   • Transaction / SecurityDeposit : renamed to LegacyTransaction / LegacySecurityDeposit for audit.
 *                  Nothing is deleted, and no exchange money is ever moved by CashMouver.
 */
import { PrismaClient } from '@prisma/client';
import { CURRENCY_SEED } from '../src/lib/currency-catalog';
import { toPublicArea } from '../src/lib/geo';

const prisma = new PrismaClient();
const DB_NAME = new URL(process.env.DATABASE_URL ?? 'mongodb://x/db').pathname.replace(/^\//, '');
const APPLY = process.argv.includes('--apply');
const UNIT = new Map(CURRENCY_SEED.map((c) => [c.code, c.minorUnit]));
const unit = (c: string) => UNIT.get(c) ?? 2;
const toMinor = (amount: number, c: string): bigint => BigInt(Math.round(amount * 10 ** unit(c)));
const scaled = (rate: number): bigint => BigInt(Math.round(rate * 1e10));
const oid = (v: any): string => (v && v.$oid) || String(v);
const date = (v: any): Date | null => (v && v.$date ? new Date(typeof v.$date === 'string' ? v.$date : Number(v.$date.$numberLong ?? v.$date)) : null);
const num = (v: any): number => (typeof v === 'number' ? v : Number(v?.$numberDouble ?? v?.$numberInt ?? v?.$numberLong ?? v ?? 0));

async function find(collection: string, filter: object): Promise<any[]> {
  const out: any[] = [];
  const first: any = await prisma.$runCommandRaw({ find: collection, filter, batchSize: 500 } as any);
  out.push(...first.cursor.firstBatch);
  let id = first.cursor.id;
  while (id && String(id.$numberLong ?? id) !== '0') {
    const next: any = await prisma.$runCommandRaw({ getMore: id, collection, batchSize: 500 } as any);
    out.push(...next.cursor.nextBatch);
    id = next.cursor.id;
  }
  return out;
}

const update = (collection: string, id: string, u: object) =>
  APPLY ? prisma.$runCommandRaw({ update: collection, updates: [{ q: { _id: { $oid: id } }, u }] } as any) : Promise.resolve();

const big = (b: bigint) => ({ $numberLong: b.toString() });

async function migrateOffers() {
  const offers = await find('SwapOffer', { haveAmount: { $exists: true }, haveTotalMinor: { $exists: false } });
  console.log(`offers to migrate: ${offers.length}`);
  for (const o of offers) {
    const id = oid(o._id);
    const total = toMinor(num(o.haveAmount), o.haveCurrency);
    const swaps = await find('Swap', { offerId: { $oid: id } });
    let reserved = 0n;
    let consumed = 0n;
    for (const s of swaps) {
      const have = toMinor(num(s.receiverGivesAmount), s.receiverGivesCurrency);
      if (['PENDING', 'AGREED', 'IN_PROGRESS', 'CONFIRMING', 'DISPUTED'].includes(s.status)) reserved += have;
      else if (s.status === 'COMPLETED') consumed += have;
    }
    let remaining = total - reserved - consumed;
    if (remaining < 0n) { remaining = 0n; reserved = total - consumed < 0n ? 0n : total - consumed; }
    const exact = { latitude: num(o.latitude), longitude: num(o.longitude) };
    const status = o.status === 'MATCHED' ? 'ACTIVE' : o.status;
    await update('SwapOffer', id, {
      $set: {
        haveTotalMinor: big(total), rateScaled: big(scaled(num(o.exchangeRate))), minSwapMinor: big(0n),
        remainingMinor: big(remaining), reservedMinor: big(reserved), consumedMinor: big(consumed),
        area: toPublicArea(exact, id), privateLocation: { type: 'Point', coordinates: [exact.longitude, exact.latitude] },
        radiusKm: o.radius ?? 5, status,
      },
      $unset: { haveAmount: '', wantAmount: '', exchangeRate: '', latitude: '', longitude: '', radius: '' },
    });
  }
}

async function migrateSwaps() {
  const swaps = await find('Swap', { initiatorGivesAmount: { $exists: true }, requestedHaveMinor: { $exists: false } });
  console.log(`swaps to migrate: ${swaps.length}`);
  for (const s of swaps) {
    const id = oid(s._id);
    const have = toMinor(num(s.receiverGivesAmount), s.receiverGivesCurrency);
    const want = toMinor(num(s.initiatorGivesAmount), s.initiatorGivesCurrency);
    const rate = scaled(num(s.agreedExchangeRate));
    const legacyDead = s.status === 'EXPIRED' || s.status === 'FAILED';
    const status = legacyDead ? 'CANCELLED' : s.status;
    const accepted = ['AGREED', 'IN_PROGRESS', 'CONFIRMING', 'COMPLETED', 'DISPUTED'].includes(status);
    const created = date(s.createdAt) ?? new Date();
    const set: Record<string, unknown> = {
      haveCurrency: s.receiverGivesCurrency, wantCurrency: s.initiatorGivesCurrency,
      requestedHaveMinor: big(have), requestedWantMinor: big(want), requestedRateScaled: big(rate),
      status, expiresAt: { $date: new Date(created.getTime() + 48 * 3600_000).toISOString() },
      initiatorConfirmed: !!(s.initiatorSentConfirmed && s.initiatorReceivedConfirmed),
      receiverConfirmed: !!(s.receiverSentConfirmed && s.receiverReceivedConfirmed),
    };
    if (accepted) Object.assign(set, { agreedHaveMinor: big(have), agreedWantMinor: big(want), agreedRateScaled: big(rate), agreedAt: s.updatedAt ?? s.createdAt });
    if (legacyDead) Object.assign(set, { cancelCode: s.status === 'EXPIRED' ? 'EXPIRED' : 'ADMIN', cancelledAt: s.updatedAt ?? s.createdAt, cancellationReason: `Migrated from legacy status ${s.status}` });
    await update('Swap', id, {
      $set: set,
      $unset: {
        initiatorGivesCurrency: '', initiatorGivesAmount: '', receiverGivesCurrency: '', receiverGivesAmount: '', agreedExchangeRate: '',
        securityDepositRequired: '', securityDepositAmount: '', feeStatus: '', initiatorFeeAmount: '', initiatorFeeWaived: '', initiatorFeePaidAt: '',
        receiverFeeAmount: '', receiverFeeWaived: '', receiverFeePaidAt: '', initiatorSentConfirmed: '', initiatorSentAt: '', initiatorReceivedConfirmed: '',
        initiatorReceivedAt: '', receiverSentConfirmed: '', receiverSentAt: '', receiverReceivedConfirmed: '', receiverReceivedAt: '',
        meetupLocation: '', meetupAddress: '', meetupTime: '', meetupLatitude: '', meetupLongitude: '', meetupNotes: '',
      },
    });
    if (APPLY && ['PENDING', 'AGREED', 'IN_PROGRESS', 'CONFIRMING', 'DISPUTED', 'COMPLETED'].includes(status)) {
      await prisma.offerReservation.upsert({
        where: { swapId: id },
        create: { offerId: oid(s.offerId), swapId: id, amountMinor: have, status: status === 'COMPLETED' ? 'CONSUMED' : 'HELD', expiresAt: new Date(created.getTime() + 7 * 86_400_000), consumedAt: status === 'COMPLETED' ? new Date() : null },
        update: {},
      });
    }
  }
}

async function migrateUsers() {
  const users = await find('User', { isPremium: { $exists: true }, planTier: { $exists: false } });
  console.log(`users to migrate: ${users.length}`);
  for (const u of users) {
    const active = u.isPremium && (!date(u.premiumExpiry) || date(u.premiumExpiry)! > new Date());
    const tier = !active ? 'FREE' : String(u.premiumTier ?? 'PREMIUM').toUpperCase().includes('BUSINESS') ? 'BUSINESS' : 'PREMIUM';
    await update('User', oid(u._id), {
      $set: { planTier: tier, ...(u.premiumExpiry ? { planExpiresAt: u.premiumExpiry } : {}) },
      $unset: { isPremium: '', premiumTier: '', premiumExpiry: '', maxSwapAmount: '' },
    });
  }
}

async function archiveLegacyCollections() {
  for (const [from, to] of [['Transaction', 'LegacyTransaction'], ['SecurityDeposit', 'LegacySecurityDeposit']]) {
    const exists: any = await prisma.$runCommandRaw({ listCollections: 1, filter: { name: from } } as any);
    if (!exists.cursor.firstBatch.length) continue;
    console.log(`archiving collection ${from} → ${to}`);
    if (APPLY) await prisma.$runCommandRaw({ renameCollection: `${DB_NAME}.${from}`, to: `${DB_NAME}.${to}` } as any);
  }
}

async function main() {
  console.log(APPLY ? 'APPLYING migration' : 'DRY RUN (pass --apply to write)');
  await migrateOffers(); // offers first: counters are derived from the swaps' LEGACY fields
  await migrateSwaps();
  await migrateUsers();
  await archiveLegacyCollections();
  console.log('done');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
