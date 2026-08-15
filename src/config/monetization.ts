/**
 * Centralized pricing & rules for every monetization feature.
 * Keeping these in one file means a pricing change is a one-line diff
 * instead of a hunt through five services.
 */

export const MONETIZATION = {
  // ── Swap platform fee (take-rate) ──────────────────────────
  swapFee: {
    // Percentage of what EACH party is giving, charged to that party.
    percent: 0.01, // 1%
    // Hard cap per side, in that side's currency's minor-unit-free amount.
    // (Simple flat cap; good enough until we have per-currency FX-aware caps.)
    capByCurrency: {
      USD: 10,
      EUR: 10,
      GBP: 9,
      NGN: 5000,
      GHS: 100,
      KES: 1000,
      ZAR: 150,
      DEFAULT: 10, // used for any currency not listed above
    } as Record<string, number>,
    // Minimum fee — not worth charging/collecting below this.
    minByCurrency: {
      USD: 0.5,
      EUR: 0.5,
      GBP: 0.5,
      NGN: 200,
      GHS: 5,
      KES: 50,
      ZAR: 8,
      DEFAULT: 0.5,
    } as Record<string, number>,
  },

  // ── Boosted / featured offers ──────────────────────────────
  boost: {
    options: [
      { hours: 24, amountCents: 199, label: '24 hours' },
      { hours: 72, amountCents: 499, label: '3 days' },
      { hours: 168, amountCents: 999, label: '7 days' },
    ],
    currency: 'usd',
  },

  // ── Verification (paid KYC) ─────────────────────────────────
  verification: {
    amountCents: 299, // $2.99 one-time
    currency: 'usd',
  },

  // ── Referral rewards ────────────────────────────────────────
  referral: {
    // Referred user's first completed swap has its platform fee waived.
    firstSwapFeeWaived: true,
    // Referrer is credited this amount (as account credit / future-fee offset)
    // once the referred user completes their first swap.
    referrerRewardUSD: 3,
  },

  // ── Business / API partner access ──────────────────────────
  partner: {
    plans: [
      {
        id: 'PARTNER_STARTER',
        name: 'Partner — Starter',
        amountCents: 4900, // $49/mo
        rateLimitPerMinute: 60,
        interval: 'month' as const,
      },
      {
        id: 'PARTNER_GROWTH',
        name: 'Partner — Growth',
        amountCents: 19900, // $199/mo
        rateLimitPerMinute: 300,
        interval: 'month' as const,
      },
    ],
    currency: 'usd',
  },

  // ── Free-tier limits (what premium removes) ─────────────────
  freeTier: {
    maxActiveOffers: 3,
  },
} as const;

export function getFeeCap(currency: string): number {
  return (
    MONETIZATION.swapFee.capByCurrency[currency.toUpperCase()] ??
    MONETIZATION.swapFee.capByCurrency.DEFAULT
  );
}

export function getFeeMin(currency: string): number {
  return (
    MONETIZATION.swapFee.minByCurrency[currency.toUpperCase()] ??
    MONETIZATION.swapFee.minByCurrency.DEFAULT
  );
}

/**
 * Computes the fee owed by one side of a swap on their given amount,
 * respecting the percentage, per-currency cap, and per-currency minimum.
 */
export function computeSwapFee(amount: number, currency: string): number {
  const raw = amount * MONETIZATION.swapFee.percent;
  const capped = Math.min(raw, getFeeCap(currency));
  const withMinimum = Math.max(capped, getFeeMin(currency));
  return Math.round(withMinimum * 100) / 100;
}
