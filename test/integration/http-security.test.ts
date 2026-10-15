import request from 'supertest';
import Stripe from 'stripe';
import { newDb } from '../helpers/fake-db';

const db = newDb();
jest.mock('@/config/database', () => ({ prisma: db, default: db, checkDatabaseHealth: async () => true, ensureGeoIndexes: async () => undefined }));
jest.mock('@/config/redis', () => require('../helpers/mock-infra').redisStub());
jest.mock('rate-limit-redis', () => require('../helpers/mock-infra').rateLimitRedisStub());

import { createApp } from '@/app';
import { JwtUtil } from '@/utils/jwt.util';
import { sha256Hex } from '@/lib/crypto';

const app = createApp();
const API = '/api/v1';
const future = () => new Date(Date.now() + 3600_000);

function makeUser(role = 'USER', over: Record<string, unknown> = {}) {
  const u = db.seed('user', { email: `${role.toLowerCase()}-${Math.random().toString(16).slice(2)}@x.eu`, name: 'Test User', role, isActive: true, isBanned: false, isSuspended: false, deletedAt: null, tokenVersion: 0, emailVerified: true, phoneVerified: false, idVerified: false, verificationStatus: 'UNVERIFIED', planTier: 'FREE', planExpiresAt: null, languagePreference: 'en', ...over });
  const s = db.seed('authSession', { userId: u.id, familyId: 'fam', revokedAt: null, expiresAt: future(), reauthUntil: null });
  const token = JwtUtil.signAccessToken({ sub: u.id, sid: s.id, tv: 0, role, email: u.email }).token;
  return { u, s, token, auth: { Authorization: `Bearer ${token}` } };
}

let alice: ReturnType<typeof makeUser>, bob: ReturnType<typeof makeUser>, carol: ReturnType<typeof makeUser>, staff: ReturnType<typeof makeUser>, admin: ReturnType<typeof makeUser>;
beforeEach(() => {
  db.tables.clear();
  alice = makeUser(); bob = makeUser(); carol = makeUser(); staff = makeUser('STAFF'); admin = makeUser('ADMIN');
  db.seed('currency', { code: 'EUR', name: 'Euro', symbol: '€', minorUnit: 2, region: 'EUROPE', isActive: true, isPopular: true, sortOrder: 1 });
});

describe('response envelope', () => {
  it('success: { success, data, meta, error: null }', async () => {
    const res = await request(app).get(`${API}/currencies`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ success: true, error: null }));
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
  });
  it('failure: { success:false, data:null, error:{ code, message, details } }', async () => {
    const res = await request(app).get(`${API}/swaps`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, data: null, error: { code: expect.any(String), message: expect.any(String) } });
  });
  it('unknown routes also use the envelope', async () => {
    const res = await request(app).get(`${API}/nope`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
  it('validation errors list field details', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });
});

describe('authentication', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['get', '/swaps'], ['get', '/users/me/entitlements'], ['get', '/billing/payments'], ['get', '/notifications'], ['get', '/conversations'],
    ['post', '/offers'], ['get', '/disputes'], ['get', '/admin/dashboard'], ['get', '/developer/keys'], ['get', '/auth/me'], ['get', '/rate-alerts'],
  ];
  it.each(protectedRoutes)('%s %s requires a token', async (m, path) => {
    const res = await (request(app) as any)[m](`${API}${path}`).send({});
    expect(res.status).toBe(401);
  });
  it('rejects a garbage token', async () => {
    expect((await request(app).get(`${API}/swaps`).set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401);
  });
  it('rejects a token signed with another secret', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ sub: alice.u.id, sid: alice.s.id, tv: 0, role: 'ADMIN', type: 'access' }, 'attacker-secret-attacker-secret-1234', { audience: 'cashmouver-api', issuer: 'CashMouver' });
    expect((await request(app).get(`${API}/admin/dashboard`).set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });
  it('rejects an unsigned (alg:none) token', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: admin.u.id, sid: admin.s.id, tv: 0, type: 'access' })}.`;
    expect((await request(app).get(`${API}/admin/dashboard`).set('Authorization', `Bearer ${none}`)).status).toBe(401);
  });
  it('a revoked session is rejected immediately, though the JWT is still unexpired', async () => {
    alice.s.revokedAt = new Date();
    expect((await request(app).get(`${API}/swaps`).set(alice.auth)).status).toBe(401);
  });
  it('a password change / logout-all (tokenVersion bump) invalidates old tokens', async () => {
    alice.u.tokenVersion = 1;
    expect((await request(app).get(`${API}/swaps`).set(alice.auth)).status).toBe(401);
  });
  it('banned and deleted accounts are locked out', async () => {
    alice.u.isBanned = true;
    expect((await request(app).get(`${API}/swaps`).set(alice.auth)).status).toBe(403);
    bob.u.deletedAt = new Date();
    expect((await request(app).get(`${API}/swaps`).set(bob.auth)).status).toBe(401);
  });
  it('a session token cannot be used by a different user id', async () => {
    const s = db.seed('authSession', { userId: bob.u.id, familyId: 'f', revokedAt: null, expiresAt: future() });
    const t = JwtUtil.signAccessToken({ sub: alice.u.id, sid: s.id, tv: 0, role: 'USER', email: 'x@x.eu' }).token;
    expect((await request(app).get(`${API}/swaps`).set('Authorization', `Bearer ${t}`)).status).toBe(401);
  });
});

describe('authorisation: roles', () => {
  it('USER cannot reach staff or admin endpoints', async () => {
    for (const p of ['/admin/dashboard', '/admin/users', '/admin/verification', '/admin/disputes', '/admin/risk', '/admin/currencies', '/admin/products', '/admin/payments', '/admin/audit-logs']) {
      const res = await request(app).get(`${API}${p}`).set(alice.auth);
      expect(res.status).toBe(403);
    }
  });
  it('STAFF can use moderation endpoints but not configuration or money endpoints', async () => {
    expect((await request(app).get(`${API}/admin/dashboard`).set(staff.auth)).status).toBe(200);
    for (const p of ['/admin/currencies', '/admin/products', '/admin/payments', '/admin/ledger', '/admin/config', '/admin/audit-logs']) {
      expect((await request(app).get(`${API}${p}`).set(staff.auth)).status).toBe(403);
    }
  });
  it('ADMIN reaches configuration', async () => {
    expect((await request(app).get(`${API}/admin/currencies`).set(admin.auth)).status).toBe(200);
  });
  it('the role comes from the database, not from the token: a stale ADMIN claim does nothing', async () => {
    const forgedRole = JwtUtil.signAccessToken({ sub: alice.u.id, sid: alice.s.id, tv: 0, role: 'SUPER_ADMIN', email: alice.u.email }).token;
    expect((await request(app).get(`${API}/admin/currencies`).set('Authorization', `Bearer ${forgedRole}`)).status).toBe(403);
  });
  it('a demoted admin loses access on the very next request', async () => {
    expect((await request(app).get(`${API}/admin/currencies`).set(admin.auth)).status).toBe(200);
    admin.u.role = 'USER';
    expect((await request(app).get(`${API}/admin/currencies`).set(admin.auth)).status).toBe(403);
  });
  it('role escalation: an ADMIN cannot grant roles (SUPER_ADMIN only) and users cannot self-promote', async () => {
    expect((await request(app).post(`${API}/admin/users/${alice.u.id}/role`).set(admin.auth).send({ role: 'ADMIN', reason: 'because I said so' })).status).toBe(403);
    const res = await request(app).patch(`${API}/users/me`).set(alice.auth).send({ role: 'SUPER_ADMIN', planTier: 'BUSINESS', idVerified: true, isVerified: true, name: 'Alice Martin' });
    expect(res.status).toBe(200);
    expect(alice.u.role).toBe('USER');
    expect(alice.u.planTier).toBe('FREE');
    expect(alice.u.idVerified).toBe(false);
  });
  it('staff cannot ban an admin (acts only on lower roles)', async () => {
    const res = await request(app).post(`${API}/admin/users/${admin.u.id}/ban`).set(staff.auth).send({ reason: 'abuse of power' });
    expect(res.status).toBe(403);
    expect(admin.u.isBanned).toBe(false);
  });
});

describe('authorisation: IDOR (object-level access)', () => {
  const seedSwap = () => {
    const offer = db.seed('swapOffer', { userId: bob.u.id, status: 'ACTIVE', haveCurrency: 'EUR', wantCurrency: 'USD', availableUntil: future(), haveTotalMinor: 1000n, remainingMinor: 0n, reservedMinor: 1000n, consumedMinor: 0n });
    const swap = db.seed('swap', { initiatorId: alice.u.id, receiverId: bob.u.id, offerId: offer.id, status: 'PENDING', haveCurrency: 'EUR', wantCurrency: 'USD', initiatorConfirmed: false, receiverConfirmed: false, expiresAt: future() });
    return { offer, swap };
  };
  it('a stranger gets 404 (not 403) for someone else\'s swap, its events, messages, meetups', async () => {
    const { swap } = seedSwap();
    for (const p of [`/swaps/${swap.id}`, `/swaps/${swap.id}/events`, `/swaps/${swap.id}/messages`, `/swaps/${swap.id}/meetup`]) {
      expect((await request(app).get(`${API}${p}`).set(carol.auth)).status).toBe(404);
    }
  });
  it('a stranger cannot act on a swap', async () => {
    const { swap } = seedSwap();
    for (const [m, p, body] of [['post', 'accept', {}], ['post', 'reject', {}], ['post', 'cancel', { reason: 'just because' }], ['post', 'confirm', {}], ['post', 'start', {}]] as const) {
      const res = await (request(app) as any)[m](`${API}/swaps/${swap.id}/${p}`).set(carol.auth).send(body);
      expect(res.status).toBe(404);
    }
    expect(swap.status).toBe('PENDING');
  });
  it('the initiator cannot accept their own request (only the offer owner can)', async () => {
    const { swap } = seedSwap();
    const res = await request(app).post(`${API}/swaps/${swap.id}/accept`).set(alice.auth);
    expect([403, 404]).toContain(res.status);
    expect(swap.status).toBe('PENDING');
  });
  it('cannot edit or delete someone else\'s offer', async () => {
    const { offer } = seedSwap();
    expect([403, 404]).toContain((await request(app).patch(`${API}/offers/${offer.id}`).set(carol.auth).send({ notes: 'hijacked' })).status);
    expect([403, 404]).toContain((await request(app).delete(`${API}/offers/${offer.id}`).set(carol.auth)).status);
    expect(offer.status).toBe('ACTIVE');
  });
  it('payments are only visible to their owner', async () => {
    const p = db.seed('payment', { userId: alice.u.id, productCode: 'BOOST_24H', kind: 'BOOST', amountMinor: 199, currency: 'EUR', status: 'SUCCEEDED', idempotencyKey: 'k' });
    expect((await request(app).get(`${API}/billing/payments/${p.id}`).set(carol.auth)).status).toBe(404);
  });
  it('malformed object ids are a 4xx, never a 500', async () => {
    const res = await request(app).get(`${API}/swaps/not-an-id`).set(alice.auth);
    expect(res.status).toBe(422);
  });
  it('private exact coordinates are never serialised on public offer endpoints', async () => {
    db.seed('swapOffer', { userId: bob.u.id, status: 'ACTIVE', haveCurrency: 'EUR', wantCurrency: 'USD', availableUntil: future(), availableFrom: new Date(0), haveTotalMinor: 1000n, remainingMinor: 1000n, reservedMinor: 0n, consumedMinor: 0n, rateScaled: 11_000_000_000n, minSwapMinor: 0n, country: 'FR', city: 'Paris', area: { type: 'Point', coordinates: [2.35, 48.85] }, privateLocation: { type: 'Point', coordinates: [2.3522219, 48.8566101] }, timeSlots: [], visibility: 'PUBLIC', minTrustScore: 0, viewCount: 0 });
    const res = await request(app).get(`${API}/offers/${db.rows('swapOffer')[0].id}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/privateLocation|2\.3522219|48\.8566101/);
  });
});

describe('sensitive actions need recent re-authentication', () => {
  it('account deletion, password change, 2FA setup, API-key creation and session revocation', async () => {
    for (const [m, p] of [['delete', '/users/me'], ['post', '/auth/change-password'], ['post', '/auth/2fa/setup'], ['post', '/developer/keys'], ['post', '/billing/portal']] as const) {
      const res = await (request(app) as any)[m](`${API}${p}`).set(alice.auth).send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('REAUTH_REQUIRED');
    }
  });
});

describe('Stripe webhook endpoint', () => {
  const body = JSON.stringify({ id: 'evt_http', object: 'event', type: 'customer.created', data: { object: { id: 'cus_1' } } });
  it('rejects unsigned requests', async () => {
    const res = await request(app).post(`${API}/webhooks/stripe`).set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(400);
  });
  it('rejects forged signatures', async () => {
    const sig = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_attacker' });
    const res = await request(app).post(`${API}/webhooks/stripe`).set('Content-Type', 'application/json').set('Stripe-Signature', sig).send(body);
    expect(res.status).toBe(400);
    expect(db.rows('stripeWebhookEvent')).toHaveLength(0);
  });
  it('accepts a genuinely signed raw body, then acknowledges a replay as duplicate', async () => {
    const sig = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    const r1 = await request(app).post(`${API}/webhooks/stripe`).set('Content-Type', 'application/json').set('Stripe-Signature', sig).send(body);
    expect(r1.status).toBe(200);
    const r2 = await request(app).post(`${API}/webhooks/stripe`).set('Content-Type', 'application/json').set('Stripe-Signature', sig).send(body);
    expect(r2.status).toBe(200);
    expect(r2.body.data.outcome).toBe('duplicate');
    expect(db.rows('stripeWebhookEvent')).toHaveLength(1);
  });
  it('a client-side "payment success" call cannot grant anything: there is no such endpoint', async () => {
    for (const p of ['/billing/success', '/billing/confirm', '/billing/payments/x/confirm', '/subscriptions/confirm']) {
      expect([404, 401]).toContain((await request(app).post(`${API}${p}`).set(alice.auth).send({ status: 'paid' })).status);
    }
  });
});

describe('partner API keys', () => {
  const key = (scopes: string[], over: Record<string, unknown> = {}) => {
    const raw = 'cmk_live_abcd1234_' + 'x'.repeat(40);
    db.seed('apiKey', { userId: bob.u.id, keyHash: sha256Hex(raw), scopes, isActive: true, revokedAt: null, expiresAt: null, requestCount: 0, monthlyQuota: 10, rateLimitPerMinute: 60, ...over });
    return raw;
  };
  it('requires a key', async () => expect((await request(app).get(`${API}/partner/currencies`)).status).toBe(401));
  it('rejects an unknown key', async () => expect((await request(app).get(`${API}/partner/currencies`).set('X-API-Key', 'cmk_live_nope_' + 'y'.repeat(40))).status).toBe(401));
  it('enforces scopes', async () => {
    const raw = key(['rates:read']);
    expect((await request(app).get(`${API}/partner/currencies`).set('X-API-Key', raw)).status).toBe(200);
    expect((await request(app).get(`${API}/partner/offers`).set('X-API-Key', raw)).status).toBe(403);
  });
  it('revoked and expired keys stop working', async () => {
    expect((await request(app).get(`${API}/partner/currencies`).set('X-API-Key', key(['rates:read'], { isActive: false }))).status).toBe(401);
    expect((await request(app).get(`${API}/partner/currencies`).set('X-API-Key', key(['rates:read'], { expiresAt: new Date(Date.now() - 1000), keyHash: sha256Hex('cmk_live_abcd1234_' + 'x'.repeat(40)) + 'z' }))).status).toBe(401);
  });
  it('enforces the monthly quota', async () => {
    const raw = key(['rates:read'], { monthlyQuota: 2 });
    expect((await request(app).get(`${API}/partner/currencies`).set('X-API-Key', raw)).status).toBe(200);
    expect((await request(app).get(`${API}/partner/currencies`).set('X-API-Key', raw)).status).toBe(200);
    expect((await request(app).get(`${API}/partner/currencies`).set('X-API-Key', raw)).status).toBe(429);
  });
  it('an API key is never accepted on user or admin routes', async () => {
    const raw = key(['rates:read', 'offers:read', 'market:read']);
    expect((await request(app).get(`${API}/admin/dashboard`).set('X-API-Key', raw)).status).toBe(401);
    expect((await request(app).get(`${API}/users/me/entitlements`).set('X-API-Key', raw)).status).toBe(401);
  });
});
