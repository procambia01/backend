import { ValidationError } from '@/utils/error.util';

/** Rejects prices that Stripe could not represent for this currency (e.g. 3-decimal currencies must be multiples of 10). */
export function toMinorService(amountMinor: number, minorUnit: number): void {
  if (!Number.isSafeInteger(amountMinor)) throw new ValidationError('Invalid amount');
  if (minorUnit === 3 && amountMinor % 10 !== 0) throw new ValidationError('Prices in 3-decimal currencies must be a multiple of 10 minor units');
}
