import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '@/config/env';

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export class HelpersUtil {
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, config.security.bcryptRounds);
  }

  static async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
    // Always run a comparison so response time doesn't reveal unknown accounts.
    return bcrypt.compare(password, hashedPassword || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  }

  /** Cryptographically random, unambiguous referral code. */
  static generateReferralCode(length = 8): string {
    const bytes = crypto.randomBytes(length);
    let code = '';
    for (let i = 0; i < length; i++) code += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
    return code;
  }

  static maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    if (!domain) return '***';
    return `${name.slice(0, 1)}${'*'.repeat(Math.max(1, name.length - 1))}@${domain}`;
  }

  static maskPhone(phone: string): string {
    return phone.length < 5 ? '***' : `${phone.slice(0, 3)}${'*'.repeat(phone.length - 5)}${phone.slice(-2)}`;
  }

  static displayName(name: string): string {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  }

  static sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  static chunk<T>(array: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
    return out;
  }

  static pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
    const out = {} as Pick<T, K>;
    for (const k of keys) if (k in obj) out[k] = obj[k];
    return out;
  }
}

export default HelpersUtil;
