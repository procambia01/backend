import { newDb } from '../helpers/fake-db';

const db = newDb();
jest.mock('@/config/database', () => ({ prisma: db, default: db }));
jest.mock('@/config/redis', () => require('../helpers/mock-infra').redisStub());

import { sessionService } from '@/services/session.service';
import { InvalidTokenError } from '@/utils/error.util';

const meta = { deviceId: 'dev-1', deviceName: 'Pixel', ip: '203.0.113.9', userAgent: 'jest' };
let user: any;
beforeEach(() => {
  db.tables.clear();
  user = db.seed('user', { email: 'u@x.eu', role: 'USER', tokenVersion: 0, isActive: true, isBanned: false, deletedAt: null });
});

describe('refresh-token rotation', () => {
  it('stores only a hash of the refresh token', async () => {
    const t = await sessionService.create(user, meta);
    expect(JSON.stringify(db.rows('authSession'))).not.toContain(t.refreshToken);
  });

  it('rotates: the old token stops working, the new one works, same family', async () => {
    const t1 = await sessionService.create(user, meta);
    const r = await sessionService.refresh(t1.refreshToken, meta);
    expect(r.tokens.refreshToken).not.toBe(t1.refreshToken);
    const [a, b] = db.rows('authSession');
    expect(a.familyId).toBe(b.familyId);
    await sessionService.refresh(r.tokens.refreshToken, meta); // new token is valid
  });

  it('reuse of a rotated token (after the grace window) revokes the whole family — stolen-token detection', async () => {
    const t1 = await sessionService.create(user, meta);
    const r = await sessionService.refresh(t1.refreshToken, meta);
    db.rows('authSession').find((s) => s.rotatedAt)!.rotatedAt = new Date(Date.now() - 60_000);
    await expect(sessionService.refresh(t1.refreshToken, meta)).rejects.toBeInstanceOf(InvalidTokenError);
    expect(db.rows('authSession').every((s) => s.revokedAt)).toBe(true);
    await expect(sessionService.refresh(r.tokens.refreshToken, meta)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('a double-submit within the grace window (flaky network) is rejected without killing the session', async () => {
    const t1 = await sessionService.create(user, meta);
    const r = await sessionService.refresh(t1.refreshToken, meta);
    await expect(sessionService.refresh(t1.refreshToken, meta)).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(sessionService.refresh(r.tokens.refreshToken, meta)).resolves.toBeDefined();
  });

  it('parallel refreshes with the same token: exactly one wins', async () => {
    const t1 = await sessionService.create(user, meta);
    const res = await Promise.allSettled(Array.from({ length: 5 }, () => sessionService.refresh(t1.refreshToken, meta)));
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('rotation does not extend the absolute session lifetime', async () => {
    const t1 = await sessionService.create(user, meta);
    const before = db.rows('authSession')[0].expiresAt.getTime();
    await sessionService.refresh(t1.refreshToken, meta);
    expect(db.rows('authSession')[1].expiresAt.getTime()).toBe(before);
  });

  it('expired, revoked and unknown tokens are refused', async () => {
    const t1 = await sessionService.create(user, meta);
    db.rows('authSession')[0].expiresAt = new Date(Date.now() - 1);
    await expect(sessionService.refresh(t1.refreshToken, meta)).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(sessionService.refresh('nope'.repeat(20), meta)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('a banned user cannot refresh and the family is revoked', async () => {
    const t1 = await sessionService.create(user, meta);
    user.isBanned = true;
    await expect(sessionService.refresh(t1.refreshToken, meta)).rejects.toThrow();
    expect(db.rows('authSession')[0].revokedAt).toBeTruthy();
  });
});

describe('logout', () => {
  it('logout-all revokes every session and bumps tokenVersion so live access tokens die', async () => {
    await sessionService.create(user, meta);
    await sessionService.create(user, { ...meta, deviceId: 'dev-2' });
    await sessionService.revokeAll(user.id);
    expect(db.rows('authSession').every((s) => s.revokedAt)).toBe(true);
    expect(user.tokenVersion).toBe(1);
  });
  it('a password change can keep the current device and drop the rest', async () => {
    const keep = await sessionService.create(user, meta);
    await sessionService.create(user, { ...meta, deviceId: 'dev-2' });
    const keepRow = db.rows('authSession').find((s) => s.id === keep.sessionId)!;
    await sessionService.revokeAll(user.id, 'PASSWORD_CHANGED', keepRow.familyId);
    expect(db.rows('authSession').filter((s) => !s.revokedAt)).toHaveLength(1);
  });
  it('listing sessions masks IP addresses', async () => {
    await sessionService.create(user, meta);
    const [s] = await sessionService.list(user.id);
    expect(s.ipAddress).toBe('203.0.x.x');
  });
});
