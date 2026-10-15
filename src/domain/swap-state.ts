/**
 * Swap state machine. The ONLY place that knows which transitions are legal.
 * Services call `assertTransition` / `canTransition`; the database update is
 * additionally guarded with `where: { status: <expected previous> }` so two
 * concurrent requests can never both win the same transition.
 */
import type { SwapStatus } from '@prisma/client';

export type SwapState = SwapStatus;

export const SWAP_TRANSITIONS: Readonly<Record<SwapState, readonly SwapState[]>> = {
  PENDING: ['AGREED', 'CANCELLED'],
  AGREED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['CONFIRMING', 'DISPUTED'],
  CONFIRMING: ['COMPLETED', 'DISPUTED'],
  DISPUTED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const TERMINAL_SWAP_STATES: readonly SwapState[] = ['COMPLETED', 'CANCELLED'];

/** Statuses in which an offer slice stays reserved for the swap. */
export const RESERVING_SWAP_STATES: readonly SwapState[] = [
  'PENDING',
  'AGREED',
  'IN_PROGRESS',
  'CONFIRMING',
  'DISPUTED',
];

export class IllegalSwapTransitionError extends Error {
  constructor(public readonly from: SwapState, public readonly to: SwapState) {
    super(`Illegal swap transition ${from} → ${to}`);
    this.name = 'IllegalSwapTransitionError';
  }
}

export function canTransition(from: SwapState, to: SwapState): boolean {
  return SWAP_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: SwapState, to: SwapState): void {
  if (!canTransition(from, to)) throw new IllegalSwapTransitionError(from, to);
}

export function isTerminal(state: SwapState): boolean {
  return TERMINAL_SWAP_STATES.includes(state);
}

/** Who may trigger which transition (besides staff / system). */
export type SwapActorRole = 'INITIATOR' | 'RECEIVER' | 'STAFF' | 'SYSTEM';

export const TRANSITION_ACTORS: Readonly<Record<string, readonly SwapActorRole[]>> = {
  'PENDING>AGREED': ['RECEIVER'],
  'PENDING>CANCELLED': ['INITIATOR', 'RECEIVER', 'SYSTEM', 'STAFF'],
  'AGREED>IN_PROGRESS': ['INITIATOR', 'RECEIVER', 'SYSTEM'],
  'AGREED>CANCELLED': ['INITIATOR', 'RECEIVER', 'SYSTEM', 'STAFF'],
  'IN_PROGRESS>CONFIRMING': ['INITIATOR', 'RECEIVER'],
  'IN_PROGRESS>DISPUTED': ['INITIATOR', 'RECEIVER', 'STAFF'],
  'CONFIRMING>COMPLETED': ['INITIATOR', 'RECEIVER'],
  'CONFIRMING>DISPUTED': ['INITIATOR', 'RECEIVER', 'STAFF'],
  'DISPUTED>COMPLETED': ['STAFF'],
  'DISPUTED>CANCELLED': ['STAFF'],
};

export function actorMayTransition(from: SwapState, to: SwapState, role: SwapActorRole): boolean {
  return TRANSITION_ACTORS[`${from}>${to}`]?.includes(role) ?? false;
}
