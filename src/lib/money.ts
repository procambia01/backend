/**
 * Exact money arithmetic for CashMouver.
 *
 * Rules
 *  - No binary floating point is ever used to compute an amount or a rate.
 *  - Amounts are integers in the currency's MINOR unit (EUR 10.50 → 1050,
 *    JPY 1000 → 1000, KWD 1.234 → 1234).
 *  - Exchange rates are fixed-point integers scaled by 10^RATE_DECIMALS
 *    ("how many `want` major units for 1 `have` major unit").
 *  - Exchange amounts use BigInt so large amounts in low-value currencies
 *    (IDR, VND) can never overflow. Service prices (what CashMouver charges)
 *    are small and fit in a JS safe integer.
 *
 * The API exchanges amounts and rates with clients as DECIMAL STRINGS
 * ("10500.50", "1.12000000") so the browser/phone never has to round-trip a
 * double either.
 */

export const RATE_DECIMALS = 10;
export const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** Integer division rounding half away from zero. */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * n + d) / (2n * d);
  return negative ? -q : q;
}

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/** Parse a non-negative decimal string into an integer scaled by 10^decimals. */
export function decimalToScaled(value: string | number, decimals: number, label = 'amount'): bigint {
  const str = typeof value === 'number' ? numberToPlain(value) : String(value).trim();
  const m = DECIMAL_RE.exec(str);
  if (!m) throw new MoneyError(`Invalid ${label}: "${value}"`);
  const frac = m[2] ?? '';
  if (frac.length > decimals) {
    // Extra trailing zeros are harmless; anything else would silently lose value.
    if (/[1-9]/.test(frac.slice(decimals))) {
      throw new MoneyError(`${label} supports at most ${decimals} decimal places`);
    }
  }
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(m[1]) * pow10(decimals) + (padded ? BigInt(padded) : 0n);
}

/** Render an integer scaled by 10^decimals as a fixed-decimal string. */
export function scaledToDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  if (decimals === 0) return `${negative ? '-' : ''}${abs.toString()}`;
  const s = abs.toString().padStart(decimals + 1, '0');
  const int = s.slice(0, -decimals);
  const frac = s.slice(-decimals);
  return `${negative ? '-' : ''}${int}.${frac}`;
}

/** JS numbers are accepted only when they print without exponent. */
function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new MoneyError('Amount must be finite');
  const s = String(n);
  if (/e/i.test(s)) throw new MoneyError('Amount is too large or too small; send it as a decimal string');
  return s;
}

// ── Amounts ───────────────────────────────────────────────────

/** "10.50" + minorUnit 2 → 1050n */
export function toMinor(amount: string | number, minorUnit: number): bigint {
  const v = decimalToScaled(amount, minorUnit, 'amount');
  return v;
}

/** 1050n + minorUnit 2 → "10.50" */
export function fromMinor(minor: bigint | number, minorUnit: number): string {
  return scaledToDecimal(BigInt(minor), minorUnit);
}

// ── Rates ─────────────────────────────────────────────────────

export function rateToScaled(rate: string | number): bigint {
  const v = decimalToScaled(rate, RATE_DECIMALS, 'exchange rate');
  if (v <= 0n) throw new MoneyError('Exchange rate must be greater than zero');
  return v;
}

/** Fixed 8-decimal display; keeps at least 2 decimals. */
export function scaledToRate(rateScaled: bigint, displayDecimals = 8): string {
  const rounded = roundDiv(rateScaled, pow10(RATE_DECIMALS - displayDecimals));
  return scaledToDecimal(rounded, displayDecimals);
}

export function inverseRate(rateScaled: bigint): bigint {
  if (rateScaled <= 0n) throw new MoneyError('Exchange rate must be greater than zero');
  return roundDiv(RATE_SCALE * RATE_SCALE, rateScaled);
}

/**
 * Convert an amount in `have` minor units into `want` minor units at `rateScaled`
 * (want major units per 1 have major unit), rounding half away from zero.
 */
export function convertMinor(
  haveMinor: bigint,
  haveMinorUnit: number,
  wantMinorUnit: number,
  rateScaled: bigint
): bigint {
  const numerator = haveMinor * rateScaled * pow10(wantMinorUnit);
  const denominator = pow10(haveMinorUnit) * RATE_SCALE;
  return roundDiv(numerator, denominator);
}

/**
 * Server-side validation of a client-supplied (have, want, rate) triple.
 * `want` must equal convert(have, rate) to within `toleranceMinor` minor units
 * (default 1 — i.e. rounding only).
 */
export function isConsistentTriple(
  haveMinor: bigint,
  wantMinor: bigint,
  rateScaled: bigint,
  haveMinorUnit: number,
  wantMinorUnit: number,
  toleranceMinor: bigint = 1n
): boolean {
  const expected = convertMinor(haveMinor, haveMinorUnit, wantMinorUnit, rateScaled);
  const diff = expected > wantMinor ? expected - wantMinor : wantMinor - expected;
  return diff <= toleranceMinor;
}

/** Rate implied by an amount pair (want per 1 have), scaled. */
export function impliedRate(
  haveMinor: bigint,
  wantMinor: bigint,
  haveMinorUnit: number,
  wantMinorUnit: number
): bigint {
  if (haveMinor <= 0n) throw new MoneyError('Have amount must be greater than zero');
  return roundDiv(wantMinor * pow10(haveMinorUnit) * RATE_SCALE, haveMinor * pow10(wantMinorUnit));
}

/** Relative difference |a-b|/b in basis points (integer). */
export function deviationBps(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new MoneyError('Reference rate is zero');
  const diff = a > b ? a - b : b - a;
  return roundDiv(diff * 10000n, b);
}

/** amount × bps / 10_000, rounded half-up. Used for referral percentages. */
export function applyBps(amountMinor: bigint | number, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) throw new MoneyError('bps must be a non-negative integer');
  return roundDiv(BigInt(amountMinor) * BigInt(bps), 10000n);
}

// ── Service-fee (Stripe) helpers ──────────────────────────────

/** Currencies Stripe treats as zero-decimal. */
const STRIPE_ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
/** Zero-decimal in ISO 4217 but Stripe's API expects two-decimal amounts. */
const STRIPE_TWO_DECIMAL_SPECIAL = new Set(['ISK', 'UGX']);
const STRIPE_THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/**
 * Convert our minor units into the integer Stripe expects for `unit_amount`.
 * Throws if the amount cannot be represented (e.g. a 3-decimal currency price
 * that is not a multiple of 10, which Stripe rejects).
 */
export function toStripeAmount(amountMinor: number, currency: string, minorUnit: number): number {
  const code = currency.toUpperCase();
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new MoneyError('Service price must be a positive integer number of minor units');
  }
  if (STRIPE_TWO_DECIMAL_SPECIAL.has(code) && minorUnit === 0) return amountMinor * 100;
  if (STRIPE_THREE_DECIMAL.has(code) && amountMinor % 10 !== 0) {
    throw new MoneyError(`${code} prices must be a multiple of 10 minor units for Stripe`);
  }
  if (STRIPE_ZERO_DECIMAL.has(code) && minorUnit !== 0 && !STRIPE_TWO_DECIMAL_SPECIAL.has(code)) {
    throw new MoneyError(`${code} is a zero-decimal currency`);
  }
  return amountMinor;
}

/** Inverse of {@link toStripeAmount}: the Stripe amount back to our minor units. */
export function fromStripeAmount(stripeAmount: number, currency: string, minorUnit: number): number {
  const code = currency.toUpperCase();
  if (STRIPE_TWO_DECIMAL_SPECIAL.has(code) && minorUnit === 0) return Math.round(stripeAmount / 100);
  return stripeAmount;
}

/**
 * Locale-aware DISPLAY formatting (emails, notifications). Never used for
 * arithmetic; the conversion to Number only happens after all maths is done.
 */
export function formatMoney(
  minor: bigint | number,
  currency: string,
  minorUnit: number,
  locale = 'en'
): string {
  const decimal = Number(scaledToDecimal(BigInt(minor), minorUnit));
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: minorUnit,
      maximumFractionDigits: minorUnit,
    }).format(decimal);
  } catch {
    return `${decimal.toFixed(minorUnit)} ${currency}`;
  }
}
