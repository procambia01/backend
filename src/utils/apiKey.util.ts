import crypto from 'crypto';

/**
 * Generates a partner API key in the form `sfx_live_<32 hex chars>`.
 * Only the SHA-256 hash is ever persisted — the raw key is shown to the
 * partner exactly once at creation time, same as Stripe/GitHub tokens.
 */
export function generateApiKey(): { rawKey: string; keyPrefix: string; keyHash: string } {
  const random = crypto.randomBytes(24).toString('hex');
  const rawKey = `sfx_live_${random}`;
  const keyPrefix = rawKey.slice(0, 12);
  const keyHash = hashApiKey(rawKey);
  return { rawKey, keyPrefix, keyHash };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}
