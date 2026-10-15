import { SWAP_TRANSITIONS, canTransition, assertTransition, IllegalSwapTransitionError, actorMayTransition, isTerminal, type SwapState } from '@/domain/swap-state';
import { SWAP_TRANSITIONS as CONTRACT_TRANSITIONS } from '@/contracts';

const ALL: SwapState[] = ['PENDING', 'AGREED', 'IN_PROGRESS', 'CONFIRMING', 'COMPLETED', 'CANCELLED', 'DISPUTED'];

describe('swap state machine', () => {
  const legal: Array<[SwapState, SwapState]> = [
    ['PENDING', 'AGREED'], ['PENDING', 'CANCELLED'], ['AGREED', 'IN_PROGRESS'], ['AGREED', 'CANCELLED'],
    ['IN_PROGRESS', 'CONFIRMING'], ['IN_PROGRESS', 'DISPUTED'], ['CONFIRMING', 'COMPLETED'], ['CONFIRMING', 'DISPUTED'],
    ['DISPUTED', 'COMPLETED'], ['DISPUTED', 'CANCELLED'],
  ];
  it.each(legal)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it('rejects every transition that is not explicitly allowed', () => {
    const allowed = new Set(legal.map(([a, b]) => `${a}>${b}`));
    for (const from of ALL) for (const to of ALL) {
      if (!allowed.has(`${from}>${to}`)) {
        expect(canTransition(from, to)).toBe(false);
        expect(() => assertTransition(from, to)).toThrow(IllegalSwapTransitionError);
      }
    }
  });

  it('cannot skip steps (PENDING → COMPLETED, AGREED → CONFIRMING)', () => {
    expect(canTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(canTransition('AGREED', 'CONFIRMING')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(false);
  });

  it('terminal states have no exits', () => {
    for (const s of ['COMPLETED', 'CANCELLED'] as const) {
      expect(isTerminal(s)).toBe(true);
      expect(SWAP_TRANSITIONS[s]).toHaveLength(0);
    }
  });

  it('has no legacy EXPIRED / FAILED states', () => {
    expect(Object.keys(SWAP_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it('server and shared contract agree on the transition table', () => {
    expect(CONTRACT_TRANSITIONS).toEqual(SWAP_TRANSITIONS);
  });

  it('only the receiver may accept; only staff may resolve a dispute', () => {
    expect(actorMayTransition('PENDING', 'AGREED', 'RECEIVER')).toBe(true);
    expect(actorMayTransition('PENDING', 'AGREED', 'INITIATOR')).toBe(false);
    expect(actorMayTransition('DISPUTED', 'COMPLETED', 'INITIATOR')).toBe(false);
    expect(actorMayTransition('DISPUTED', 'COMPLETED', 'STAFF')).toBe(true);
    expect(actorMayTransition('DISPUTED', 'CANCELLED', 'RECEIVER')).toBe(false);
  });
});
