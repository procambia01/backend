import { toMinor, fromMinor, rateToScaled, scaledToRate, convertMinor, isConsistentTriple, impliedRate, inverseRate, deviationBps, applyBps, roundDiv, MoneyError, toStripeAmount, fromStripeAmount, RATE_SCALE } from '@/lib/money';

describe('money: parsing and formatting by currency precision', () => {
  it('EUR 10.50 → 1050 minor units and back', () => {
    expect(toMinor('10.50', 2)).toBe(1050n);
    expect(fromMinor(1050n, 2)).toBe('10.50');
  });
  it('USD 25.99 → 2599', () => expect(toMinor('25.99', 2)).toBe(2599n));
  it('JPY 1000 → 1000 (zero-decimal)', () => {
    expect(toMinor('1000', 0)).toBe(1000n);
    expect(fromMinor(1000n, 0)).toBe('1000');
  });
  it('KWD uses three decimals', () => expect(toMinor('1.234', 3)).toBe(1234n));
  it('rejects more decimals than the currency supports instead of silently rounding', () => {
    expect(() => toMinor('10.505', 2)).toThrow(MoneyError);
    expect(() => toMinor('10.5', 0)).toThrow(MoneyError);
  });
  it('accepts harmless trailing zeros', () => expect(toMinor('10.500', 2)).toBe(1050n));
  it('rejects garbage, negatives and exponents', () => {
    for (const bad of ['abc', '-5', '1e3', '', '1,5', '1..2']) expect(() => toMinor(bad, 2)).toThrow(MoneyError);
  });
  it('is exact where binary floats are not (0.1 + 0.2)', () => {
    expect(toMinor('0.10', 2) + toMinor('0.20', 2)).toBe(toMinor('0.30', 2));
  });
  it('handles very large amounts without precision loss', () => {
    expect(toMinor('999999999999.99', 2)).toBe(99999999999999n);
  });
});

describe('money: rounding', () => {
  it('rounds half away from zero', () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(roundDiv(4n, 3n)).toBe(1n);
  });
  it('throws on division by zero', () => expect(() => roundDiv(1n, 0n)).toThrow(MoneyError));
});

describe('money: fixed-point exchange rates', () => {
  it('stores rates scaled by 1e10', () => {
    expect(rateToScaled('1.12')).toBe(11_200_000_000n);
    expect(scaledToRate(11_200_000_000n, 4)).toBe('1.1200');
  });
  it('rejects zero rates', () => expect(() => rateToScaled('0')).toThrow(MoneyError));
  it('converts across different minor units (EUR → JPY)', () => {
    // 100.00 EUR at 160.5 JPY per EUR = 16050 JPY
    expect(convertMinor(10_000n, 2, 0, rateToScaled('160.5'))).toBe(16050n);
  });
  it('converts across different minor units (JPY → KWD)', () => {
    // 1000 JPY at 0.002 KWD per JPY = 2.000 KWD = 2000 minor
    expect(convertMinor(1000n, 0, 3, rateToScaled('0.002'))).toBe(2000n);
  });
  it('inverse of inverse is within rounding of the original', () => {
    const r = rateToScaled('1.1234567891');
    const back = inverseRate(inverseRate(r));
    expect(back > r ? back - r : r - back).toBeLessThanOrEqual(1n);
  });
  it('validates the have/want/rate triple server-side', () => {
    const rate = rateToScaled('1.12');
    expect(isConsistentTriple(10_000n, 11_200n, rate, 2, 2)).toBe(true);
    expect(isConsistentTriple(10_000n, 11_201n, rate, 2, 2)).toBe(true); // 1 minor unit of rounding tolerance
    expect(isConsistentTriple(10_000n, 12_000n, rate, 2, 2)).toBe(false);
  });
  it('implied rate round-trips', () => {
    expect(impliedRate(10_000n, 11_200n, 2, 2)).toBe(rateToScaled('1.12'));
  });
  it('deviation in basis points is integer', () => {
    expect(deviationBps(rateToScaled('1.10'), rateToScaled('1.00'))).toBe(1000n);
    expect(deviationBps(RATE_SCALE, RATE_SCALE)).toBe(0n);
  });
});

describe('money: service fees and percentages', () => {
  it('applies basis points exactly', () => {
    expect(applyBps(999, 1500)).toBe(150n); // 14.985 → 15.00? 999*0.15 = 149.85 → 150
    expect(applyBps(1000, 2500)).toBe(250n);
    expect(applyBps(0, 5000)).toBe(0n);
  });
  it('rejects fractional or negative bps', () => {
    expect(() => applyBps(100, 1.5)).toThrow(MoneyError);
    expect(() => applyBps(100, -1)).toThrow(MoneyError);
  });
});

describe('money: Stripe amount mapping', () => {
  it('passes two-decimal currencies through', () => expect(toStripeAmount(999, 'EUR', 2)).toBe(999));
  it('passes zero-decimal currencies through', () => expect(toStripeAmount(500, 'JPY', 0)).toBe(500));
  it('maps ISK (zero-decimal in ISO, two-decimal in Stripe) ×100 and back', () => {
    expect(toStripeAmount(500, 'ISK', 0)).toBe(50_000);
    expect(fromStripeAmount(50_000, 'ISK', 0)).toBe(500);
  });
  it('rejects three-decimal prices Stripe would refuse', () => expect(() => toStripeAmount(1005, 'KWD', 3)).toThrow(MoneyError));
  it('rejects zero, negative and non-integer prices', () => {
    for (const bad of [0, -1, 1.5]) expect(() => toStripeAmount(bad, 'EUR', 2)).toThrow(MoneyError);
  });
});
