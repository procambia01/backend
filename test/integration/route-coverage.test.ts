import request from 'supertest';
import { newDb } from '../helpers/fake-db';

const db = newDb();
jest.mock('@/config/database', () => ({ prisma: db, default: db, checkDatabaseHealth: async () => true, ensureGeoIndexes: async () => undefined }));
jest.mock('@/config/redis', () => require('../helpers/mock-infra').redisStub());
jest.mock('rate-limit-redis', () => require('../helpers/mock-infra').rateLimitRedisStub());

import { createApp, API_PREFIX } from '@/app';

const app = createApp();
type Route = { method: string; path: string };

/** Walk Express 4's router stack and rebuild every mounted path. */
function collect(stack: any[], prefix = ''): Route[] {
  const out: Route[] = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods)) out.push({ method: m, path: prefix + layer.route.path });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const mount = layer.regexp.source
        .replace(/^\^/, '')
        .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
        .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ':p')
        .replace(/\\\//g, '/');
      out.push(...collect(layer.handle.stack, prefix + mount));
    }
  }
  return out;
}

// Routes that are intentionally reachable without a user session.
const PUBLIC = [
  /^post \/auth\/(register|login|refresh|forgot-password|reset-password|verify-email)$/,
  /^get \/(currencies|config|products)$/,
  /^get \/rates\/:base\/:quote(\/history)?$/,
  /^get \/market\/(popular|:base\/:quote)$/,
  /^get \/ads$/, /^post \/ads\/:id\/click$/,
  /^post \/promotions\/:type\/:id\/click$/, /^post \/referrals\/click\/:code$/,
  /^get \/offers(\/featured|\/:id)?$/,
  /^get \/users\/:id\/public$/,
  /^get \/partner\/.*$/, // protected by X-API-Key instead (asserted below)
  /^post \/webhooks\/stripe$/, // protected by signature (asserted in stripe tests)
];

describe('every route is protected unless it is explicitly public', () => {
  const routes = collect((app as any)._router.stack).filter((r) => r.path.startsWith(API_PREFIX));
  const rel = routes.map((r) => ({ ...r, path: (r.path.slice(API_PREFIX.length).replace(/\/+$/, '') || '/') }));

  it('discovers a realistic number of routes', () => expect(rel.length).toBeGreaterThan(120));

  it('no unexpected public route exists', async () => {
    const leaks: string[] = [];
    for (const r of rel) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.some((re) => re.test(key))) continue;
      const url = `${API_PREFIX}${r.path.replace(/:[A-Za-z]+/g, '507f1f77bcf86cd799439011')}`;
      const res = await (request(app) as any)[r.method](url).send({});
      if (res.status !== 401) leaks.push(`${key} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('partner routes need an API key', async () => {
    for (const r of rel.filter((x) => x.path.startsWith('/partner'))) {
      const res = await (request(app) as any)[r.method](`${API_PREFIX}${r.path.replace(/:[A-Za-z]+/g, 'EUR')}`);
      expect(res.status).toBe(401);
    }
  });

  it('there is no custody-style endpoint anywhere', () => {
    const bad = rel.filter((r) => /wallet|escrow|deposit|withdraw|payout|balance|top-?up|paystack|flutterwave/i.test(r.path));
    expect(bad).toEqual([]);
  });
});
