/**
 * Architectural guard-rails expressed as tests, so a future change that
 * re-introduces custody, float money, Paystack, Nigerian content or mutable
 * financial history fails CI instead of slipping through review.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', '.git'].includes(f.name)) continue;
    const p = path.join(dir, f.name);
    f.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const read = (p: string) => fs.readFileSync(p, 'utf8');
const SRC = walk(path.join(ROOT, 'src')).filter((f) => /\.(ts|json)$/.test(f));
const schema = read(path.join(ROOT, 'prisma/schema.prisma'));

describe('data model', () => {
  it('uses no floating point for money, rates or fees', () => {
    const offenders = schema.split('\n').filter((l) => /\bFloat\b/.test(l) && /(amount|price|rate|fee|balance|total|minor|cost|revenue|commission|reward)/i.test(l.split('//')[0]) && !/rating|responseRate|confirmationRate|completionRate/i.test(l));
    expect(offenders).toEqual([]);
  });
  it('has no custody models (wallet / escrow / deposit / withdrawal / balance)', () => {
    const models = [...schema.matchAll(/^model (\w+)/gm)].map((m) => m[1]);
    expect(models.filter((m) => /wallet|escrow|deposit|withdraw|payout|balance|transaction$/i.test(m))).toEqual([]);
  });
  it('has unique constraints for idempotency', () => {
    expect(schema).toMatch(/model StripeWebhookEvent[\s\S]*?stripeEventId\s+String\s+@unique/);
    expect(schema).toMatch(/model LedgerEntry[\s\S]*?reference\s+String\s+@unique/);
    expect(schema).toMatch(/model SwapEvent[\s\S]*?dedupeKey\s+String\s+@unique/);
    expect(schema).toMatch(/model Payment[\s\S]*?idempotencyKey\s+String\s+@unique/);
    expect(schema).toMatch(/model ApiKey[\s\S]*?keyHash\s+String\s+@unique/);
  });
  it('indexes the geospatial fields used for discovery', () => {
    expect(read(path.join(ROOT, 'src/config/database.ts'))).toMatch(/2dsphere/);
  });
});

describe('financial history is append-only', () => {
  const code = SRC.filter((f) => f.endsWith('.ts')).map((f) => [f, read(f)] as const);
  it.each(['ledgerEntry', 'swapEvent', 'auditLog', 'stripeWebhookEvent.delete'])('%s is never updated or deleted', (model) => {
    const base = model.split('.')[0];
    const re = new RegExp(`${base}\\.(update|updateMany|upsert|delete|deleteMany)\\(`);
    const hits = code.filter(([f, s]) => re.test(s) && !(base === 'stripeWebhookEvent' && /stripe-webhook\.service/.test(f))).map(([f]) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});

describe('removed concepts stay removed', () => {
  const FILES = [...SRC, path.join(ROOT, 'prisma/schema.prisma'), path.join(ROOT, '.env.example'), path.join(ROOT, 'package.json'), ...walk(path.join(ROOT, 'prisma')).filter((f) => f.endsWith('seed.ts'))];
  const scan = (re: RegExp) => FILES.filter((f) => re.test(read(f))).map((f) => path.relative(ROOT, f));
  it('Paystack / Flutterwave', () => expect(scan(/paystack|flutterwave/i)).toEqual([]));
  it('Nigerian content', () => expect(scan(/nigeria|\bNGN\b|₦|lagos|abuja|port harcourt|\bkano\b|ibadan/i)).toEqual([]));
  it('legacy brand name and auth library', () => expect(scan(/cashmova|better-auth/i)).toEqual([]));
  // Comments may explain what the product deliberately does NOT do, so strip them for this check.
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('escrow / security deposits / wallets / withdrawals (in code, not comments)', () =>
    expect(FILES.filter((f) => /escrow|securityDeposit|\bwallet\b|withdraw(al)?s?\b/i.test(code(f))).map((f) => path.relative(ROOT, f))).toEqual([]));
  it('no TODO / FIXME left behind', () => expect(scan(/\b(TODO|FIXME|XXX)\b/)).toEqual([]));
});

describe('payments', () => {
  const app = read(path.join(ROOT, 'src/app.ts'));
  it('the Stripe webhook is mounted before the JSON body parser (raw body preserved)', () => {
    expect(app.indexOf('/webhooks')).toBeGreaterThan(-1);
    expect(app.indexOf('/webhooks')).toBeLessThan(app.indexOf('express.json'));
  });
  it('never verifies signatures against a re-serialised body', () => {
    expect(SRC.filter((f) => /JSON\.stringify\(req\.body\)/.test(read(f)))).toEqual([]);
  });
  it('Stripe is the only payment SDK', () => {
    const deps = Object.keys(JSON.parse(read(path.join(ROOT, 'package.json'))).dependencies);
    expect(deps.filter((d) => /paystack|flutterwave|paypal|braintree|razorpay|square/i.test(d))).toEqual([]);
    expect(deps).toContain('stripe');
  });
  it('prices come from the database, never from request bodies', () => {
    const billing = read(path.join(ROOT, 'src/services/billing.service.ts'));
    expect(billing).toMatch(/serviceProduct\.findUnique/);
    const routes = read(path.join(ROOT, 'src/routes/billing.routes.ts'));
    expect(routes).not.toMatch(/amount|price/i);
  });
});

describe('logging hygiene', () => {
  it('does not log secrets', () => {
    const offenders = SRC.filter((f) => f.endsWith('.ts')).filter((f) => /logger\.(info|warn|error|debug)\([^;]*\b(password|passwordHash|otp|code:|token:|refreshToken|documentNumber|cardNumber)\b/.test(read(f)));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
  it('request logging never records bodies or headers', () => {
    expect(read(path.join(ROOT, 'src/middleware/logger.middleware.ts'))).not.toMatch(/req\.body|req\.headers/);
  });
});
