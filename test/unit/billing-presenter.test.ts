import { toPaymentDto, toServiceProductDto, toSubscriptionDto } from '@/presenters/billing.presenter';

const units = { get: (c: string) => ({ EUR: 2, JPY: 0, KWD: 3 }[c] ?? 2) };
const now = new Date('2026-01-02T03:04:05Z');

describe('billing presenters', () => {
  it('emit decimal strings in the currency precision, never minor integers', () => {
    const p = toServiceProductDto({ code: 'X', kind: 'BOOST', name: 'n', description: null, amountMinor: 1050, currency: 'EUR', interval: 'ONE_TIME', durationHours: 24, planTier: null, placement: null, trialDays: 0, features: [] } as never, units);
    expect(p.amount).toBe('10.50');
    expect(p).not.toHaveProperty('amountMinor');
    expect(toServiceProductDto({ amountMinor: 1000, currency: 'JPY' } as never, units).amount).toBe('1000');
    expect(toServiceProductDto({ amountMinor: 1234, currency: 'KWD' } as never, units).amount).toBe('1.234');
  });

  it('payments expose refunded amount and no internal Stripe ids', () => {
    const d = toPaymentDto({ id: 'p', productCode: 'X', kind: 'BOOST', amountMinor: 999, refundedMinor: 100, currency: 'EUR', status: 'PARTIALLY_REFUNDED', targetType: null, targetId: null, createdAt: now, paidAt: now, failureReason: null, stripePaymentIntentId: 'pi_secret', stripeCheckoutSessionId: 'cs_x' } as never, units);
    expect(d.amount).toBe('9.99');
    expect(d.refundedAmount).toBe('1.00');
    expect(JSON.stringify(d)).not.toMatch(/pi_secret|cs_x/);
  });

  it('subscriptions convert price and dates', () => {
    const d = toSubscriptionDto({ id: 's', productCode: 'P', tier: 'PREMIUM', status: 'ACTIVE', interval: 'MONTH', amountMinor: 499, currency: 'EUR', currentPeriodEnd: now, cancelAtPeriodEnd: false, trialEnd: null } as never, units);
    expect(d.amount).toBe('4.99');
    expect(d.currentPeriodEnd).toBe(now.toISOString());
    expect(d.trialEnd).toBeNull();
  });
});
