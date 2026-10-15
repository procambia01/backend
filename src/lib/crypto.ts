import crypto from 'crypto';

export const sha256Hex = (value: string | Buffer): string =>
  crypto.createHash('sha256').update(value).digest('hex');

export const hmacSha256Hex = (secret: string, value: string): string =>
  crypto.createHmac('sha256', secret).update(value).digest('hex');

export function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Uniformly random numeric code (rejection sampling — no modulo bias). */
export function randomNumericCode(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(0x100000000 / max) * max;
  for (;;) {
    const n = crypto.randomBytes(4).readUInt32BE(0);
    if (n < limit) return String(n % max).padStart(digits, '0');
  }
}

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

/** HMAC of a low-entropy value (OTP, IP, device id) keyed with a server secret. */
export const keyedHash = (secret: string, value: string): string => hmacSha256Hex(secret, value);

// AES-256-GCM for small secrets at rest (TOTP seeds).
export function encryptSecret(plain: string, keyMaterial: string): string {
  const key = crypto.createHash('sha256').update(keyMaterial).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(payload: string, keyMaterial: string): string {
  const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const key = crypto.createHash('sha256').update(keyMaterial).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
