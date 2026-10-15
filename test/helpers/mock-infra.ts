/** Shared jest.mock factories for infrastructure that must never be touched in unit tests. */
export const redisStub = () => ({
  __esModule: true,
  default: {
    getClient: () => ({ status: 'end', call: async () => null }),
    getSubscriber: () => ({}),
    getPublisher: () => ({}),
    healthCheck: async () => false,
    disconnect: async () => undefined,
  },
});

/** In-memory replacement for rate-limit-redis' store (same contract: init → increment → …). */
export const rateLimitRedisStub = () => {
  class MemoryStore {
    private hits = new Map<string, { n: number; reset: number }>();
    private windowMs = 60_000;
    constructor(private opts: { prefix?: string }) {}
    init(o: { windowMs: number }) {
      if (typeof o.windowMs !== 'number') throw new Error('windowMs must be forwarded to the store');
      this.windowMs = o.windowMs;
    }
    async increment(key: string) {
      const k = `${this.opts.prefix}${key}`;
      const now = Date.now();
      const cur = this.hits.get(k);
      const e = !cur || cur.reset <= now ? { n: 0, reset: now + this.windowMs } : cur;
      e.n += 1;
      this.hits.set(k, e);
      return { totalHits: e.n, resetTime: new Date(e.reset) };
    }
    async decrement(key: string) { const e = this.hits.get(`${this.opts.prefix}${key}`); if (e) e.n -= 1; }
    async resetKey(key: string) { this.hits.delete(`${this.opts.prefix}${key}`); }
  }
  return { __esModule: true, default: MemoryStore };
};
