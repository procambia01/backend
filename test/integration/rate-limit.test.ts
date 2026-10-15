import request from 'supertest';
import { newDb } from '../helpers/fake-db';

const db = newDb();
jest.mock('@/config/database', () => ({ prisma: db, default: db, checkDatabaseHealth: async () => true, ensureGeoIndexes: async () => undefined }));
jest.mock('@/config/redis', () => ({ __esModule: true, default: { getClient: () => ({ status: 'ready', call: async () => null }), healthCheck: async () => true } }));
jest.mock('rate-limit-redis', () => require('../helpers/mock-infra').rateLimitRedisStub());

import { config } from '@/config/env';
import { createApp } from '@/app';

const app = createApp();
const API = '/api/v1';

beforeAll(() => { (config as { isTest: boolean }).isTest = false; }); // rate limiting is skipped in tests by default
afterAll(() => { (config as { isTest: boolean }).isTest = true; });

describe('rate limiting', () => {
  it('login: the 11th attempt for one email from one IP is throttled with the standard envelope', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await request(app).post(`${API}/auth/login`).send({ email: 'victim@example.eu', password: 'wrong-password' })).status);
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
    const last = await request(app).post(`${API}/auth/login`).send({ email: 'victim@example.eu', password: 'x' });
    expect(last.body).toMatchObject({ success: false, data: null, error: { code: 'RATE_LIMITED' } });
  });

  it('login: a different email is not affected by someone else\'s lockout', async () => {
    for (let i = 0; i < 11; i++) await request(app).post(`${API}/auth/login`).send({ email: 'a@example.eu', password: 'x' });
    const other = await request(app).post(`${API}/auth/login`).send({ email: 'b@example.eu', password: 'x' });
    expect(other.status).not.toBe(429);
  });

  it('password reset: throttled after 5 requests', async () => {
    const out: number[] = [];
    for (let i = 0; i < 7; i++) out.push((await request(app).post(`${API}/auth/forgot-password`).send({ email: 'reset@example.eu' })).status);
    expect(out.slice(5)).toEqual([429, 429]);
  });

  it('registration is throttled per IP', async () => {
    const out: number[] = [];
    for (let i = 0; i < 12; i++) out.push((await request(app).post(`${API}/auth/register`).send({})).status);
    expect(out).toContain(429);
  });

  it('the store receives the window length (regression: it used to be dropped, which silently disabled limiting in production)', async () => {
    const res = await request(app).post(`${API}/auth/refresh`).send({ refreshToken: 'x'.repeat(30) });
    expect(res.headers['ratelimit-limit'] ?? res.headers['x-ratelimit-limit']).toBeDefined();
  });
});
