import { mergePolicies, applicableKeys, DEFAULT_LIMIT_POLICIES } from '@/services/limit.service';
import { effectivePlan, isPremium } from '@/lib/entitlements';

const user = (o: Record<string, unknown> = {}) => ({ idVerified: false, verificationStatus: 'UNVERIFIED', verificationTier: null, planTier: 'FREE', planExpiresAt: null, ...o }) as never;
const pol = (k: string) => DEFAULT_LIMIT_POLICIES.find((p) => p.key === k)!;

describe('limits by verification tier and plan', () => {
  it('unverified users get the lowest limits', () => {
    expect(applicableKeys(user())).toEqual(['UNVERIFIED']);
  });
  it('verified and enhanced tiers map to their policy', () => {
    expect(applicableKeys(user({ idVerified: true, verificationStatus: 'VERIFIED' }))).toEqual(['VERIFIED']);
    expect(applicableKeys(user({ idVerified: true, verificationStatus: 'VERIFIED', verificationTier: 'ENHANCED' }))).toEqual(['ENHANCED']);
  });
  it('a client-set flag alone does not grant tier: needs VERIFIED status too', () => {
    expect(applicableKeys(user({ idVerified: true, verificationStatus: 'PENDING' }))).toEqual(['UNVERIFIED']);
  });
  it('an active plan adds its policy; an expired plan does not', () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    expect(applicableKeys(user({ planTier: 'PREMIUM', planExpiresAt: future }))).toContain('PREMIUM');
    expect(applicableKeys(user({ planTier: 'PREMIUM', planExpiresAt: past }))).toEqual(['UNVERIFIED']);
    expect(effectivePlan({ planTier: 'BUSINESS', planExpiresAt: past } as never)).toBe('FREE');
    expect(isPremium({ planTier: 'PREMIUM', planExpiresAt: future } as never)).toBe(true);
  });
  it('merging takes the most generous value for each limit and ORs feature flags', () => {
    const m = mergePolicies([pol('UNVERIFIED'), pol('PREMIUM')]);
    expect(m.maxSwapMinor).toBe(pol('PREMIUM').maxSwapMinor);
    expect(m.advancedSearch).toBe(true);
    expect(m.sources).toEqual(['UNVERIFIED', 'PREMIUM']);
  });
  it('limits grow monotonically with trust', () => {
    const order = ['UNVERIFIED', 'VERIFIED', 'ENHANCED'].map(pol);
    for (let i = 1; i < order.length; i++) {
      expect(order[i].maxSwapMinor > order[i - 1].maxSwapMinor).toBe(true);
      expect(order[i].dailyMinor >= order[i - 1].dailyMinor).toBe(true);
    }
  });
});
