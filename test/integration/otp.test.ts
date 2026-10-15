import { newDb } from '../helpers/fake-db';

const db = newDb();
jest.mock('@/config/database', () => ({ prisma: db, default: db }));
jest.mock('@/config/redis', () => require('../helpers/mock-infra').redisStub());
jest.mock('@/services/activity.service', () => ({ logActivity: jest.fn(async () => undefined) }));
const sent: string[] = [];
jest.mock('@/services/sms.service', () => ({ smsService: { send: jest.fn(async (_to: string, body: string) => { sent.push(body); }) } }));

import { phoneService } from '@/services/phone.service';
import { BadRequestError, ConflictError, TooManyRequestsError } from '@/utils/error.util';

const PHONE = '+442071234567';
const lastCode = () => /(\d{6})/.exec(sent[sent.length - 1])![1];
let u: any;

beforeEach(() => {
  db.tables.clear();
  sent.length = 0;
  u = db.seed('user', { email: 'o@x.eu', languagePreference: 'en', phoneVerified: false });
});

describe('phone OTP', () => {
  it('sends a 6-digit code and stores only a hash', async () => {
    await phoneService.requestOtp(u.id, PHONE);
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    const row = db.rows('otpChallenge')[0];
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.codeHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifies the right code once, marks the phone verified and reserves the number', async () => {
    await phoneService.requestOtp(u.id, PHONE);
    await phoneService.verifyOtp(u.id, lastCode());
    expect(u.phoneVerified).toBe(true);
    expect(db.rows('verifiedPhone')).toHaveLength(1);
    await expect(phoneService.verifyOtp(u.id, lastCode())).rejects.toThrow(); // consumed
  });

  it('enforces a resend cooldown', async () => {
    await phoneService.requestOtp(u.id, PHONE);
    await expect(phoneService.requestOtp(u.id, PHONE)).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it('locks after 5 wrong guesses, even for the correct code afterwards', async () => {
    await phoneService.requestOtp(u.id, PHONE);
    const right = lastCode();
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await expect(phoneService.verifyOtp(u.id, wrong)).rejects.toBeInstanceOf(BadRequestError);
    await expect(phoneService.verifyOtp(u.id, right)).rejects.toBeInstanceOf(TooManyRequestsError);
    expect(u.phoneVerified).toBe(false);
  });

  it('parallel guessing cannot exceed the attempt budget', async () => {
    await phoneService.requestOtp(u.id, PHONE);
    const right = lastCode();
    const wrong = right === '000000' ? '111111' : '000000';
    const res = await Promise.allSettled(Array.from({ length: 30 }, () => phoneService.verifyOtp(u.id, wrong)));
    expect(db.rows('otpChallenge')[0].attempts).toBeLessThanOrEqual(5);
    expect(res.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('rejects an expired code', async () => {
    await phoneService.requestOtp(u.id, PHONE);
    db.rows('otpChallenge')[0].expiresAt = new Date(Date.now() - 1000);
    await expect(phoneService.verifyOtp(u.id, lastCode())).rejects.toBeInstanceOf(BadRequestError);
  });

  it('a code for one account is useless for another (hash is bound to user and phone)', async () => {
    await phoneService.requestOtp(u.id, PHONE);
    const other = db.seed('user', { email: 'p@x.eu', languagePreference: 'en' });
    db.rows('otpChallenge')[0].userId = other.id; // attacker tries to reuse the challenge row
    await expect(phoneService.verifyOtp(other.id, lastCode())).rejects.toBeInstanceOf(BadRequestError);
  });

  it('a phone number already verified by someone else cannot be claimed', async () => {
    db.seed('verifiedPhone', { userId: 'someone-else', phone: PHONE });
    await expect(phoneService.requestOtp(u.id, PHONE)).rejects.toBeInstanceOf(ConflictError);
  });

  it('caps requests per day', async () => {
    for (let i = 0; i < 10; i++) db.seed('otpChallenge', { userId: u.id, purpose: 'PHONE_VERIFY', phone: PHONE, codeHash: 'x', attempts: 0, maxAttempts: 5, resendAvailableAt: new Date(0), expiresAt: new Date(Date.now() + 1000), consumedAt: new Date(), createdAt: new Date() });
    await expect(phoneService.requestOtp(u.id, PHONE)).rejects.toBeInstanceOf(TooManyRequestsError);
  });
});
