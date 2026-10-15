/**
 * Minimal in-memory stand-in for the Prisma client, just rich enough to run the
 * marketplace / billing logic in unit tests.
 *
 * IMPORTANT: every call body is synchronous, so each `updateMany` is atomic —
 * the same guarantee MongoDB gives a single-document conditional update. These
 * tests therefore prove the LOGIC (guards, idempotency keys, counters) holds
 * under interleaved async callers. They do NOT prove MongoDB behaviour.
 */
import crypto from 'crypto';

type Row = Record<string, any>;
const OPS = new Set(['equals', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'not', 'contains', 'startsWith', 'mode', 'has', 'isEmpty']);
const isPlain = (v: unknown): v is Row => !!v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && typeof v !== 'bigint';
const val = (v: any) => (v instanceof Date ? v.getTime() : v);
const eq = (a: any, b: any) => (a === undefined || a === null ? b === null || b === undefined : val(a) === val(b));

function matchField(actual: any, cond: any): boolean {
  if (!isPlain(cond)) return eq(actual, cond);
  const keys = Object.keys(cond);
  if (!keys.every((k) => OPS.has(k))) return JSON.stringify(actual) === JSON.stringify(cond);
  return keys.every((k) => {
    const c = cond[k];
    switch (k) {
      case 'equals': return eq(actual, c);
      case 'in': return (c as any[]).some((x) => eq(actual, x));
      case 'notIn': return !(c as any[]).some((x) => eq(actual, x));
      case 'gt': return actual != null && val(actual) > val(c);
      case 'gte': return actual != null && val(actual) >= val(c);
      case 'lt': return actual != null && val(actual) < val(c);
      case 'lte': return actual != null && val(actual) <= val(c);
      case 'not': return !matchField(actual, c);
      case 'contains': return String(actual ?? '').toLowerCase().includes(String(c).toLowerCase());
      case 'startsWith': return String(actual ?? '').startsWith(String(c));
      case 'has': return Array.isArray(actual) && actual.includes(c);
      case 'isEmpty': return Array.isArray(actual) && (actual.length === 0) === c;
      default: return true;
    }
  });
}

export function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond === undefined) return true;
    if (k === 'AND') return ([] as Row[]).concat(cond).every((w) => matches(row, w));
    if (k === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (k === 'NOT') return !([] as Row[]).concat(cond).some((w) => matches(row, w));
    // compound unique selector, e.g. { apiKeyId_day: { apiKeyId, day } }
    if (k.includes('_') && isPlain(cond) && !Object.keys(cond).some((x) => OPS.has(x))) return matches(row, cond);
    return matchField(row[k], cond);
  });
}

function applyData(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (isPlain(v) && ('increment' in v || 'decrement' in v || 'set' in v || 'push' in v)) {
      if ('increment' in v) row[k] = (row[k] ?? (typeof v.increment === 'bigint' ? 0n : 0)) + v.increment;
      else if ('decrement' in v) row[k] = (row[k] ?? (typeof v.decrement === 'bigint' ? 0n : 0)) - v.decrement;
      else if ('push' in v) row[k] = [...(row[k] ?? []), ...([] as any[]).concat(v.push)];
      else row[k] = v.set;
    } else row[k] = v;
  }
  if ('updatedAt' in row || true) row.updatedAt = new Date();
}

export class FakeDb {
  tables = new Map<string, Row[]>();
  uniques: Record<string, string[][]> = {};
  defaults: Record<string, Row> = {};
  [key: string]: any;

  constructor(uniques: Record<string, string[][]> = {}, defaults: Record<string, Row> = {}) {
    this.uniques = uniques;
    this.defaults = defaults;
    return new Proxy(this, {
      get: (t, prop: string) => {
        if (prop in t || typeof prop === 'symbol') return (t as any)[prop];
        if (prop === 'then') return undefined;
        return t.model(prop);
      },
    });
  }

  rows(name: string): Row[] {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }

  seed(name: string, row: Row): Row {
    const full = { id: crypto.randomBytes(12).toString('hex'), createdAt: new Date(), updatedAt: new Date(), ...(this.defaults[name] ?? {}), ...row };
    this.rows(name).push(full);
    return full;
  }

  private checkUnique(name: string, candidate: Row, ignore?: Row) {
    for (const fields of this.uniques[name] ?? []) {
      if (fields.some((f) => candidate[f] === undefined || candidate[f] === null)) continue;
      const clash = this.rows(name).find((r) => r !== ignore && fields.every((f) => eq(r[f], candidate[f])));
      if (clash) throw Object.assign(new Error(`Unique constraint failed on ${name}.${fields.join(',')}`), { code: 'P2002' });
    }
  }

  model(name: string) {
    const rows = () => this.rows(name);
    const withInclude = (row: Row | null, include?: Row) => {
      if (!row || !include) return row;
      const out = { ...row };
      for (const [rel, on] of Object.entries(include)) {
        if (!on) continue;
        const fk = row[`${rel}Id`];
        if (fk !== undefined) out[rel] = this.rows(rel).find((x) => x.id === fk) ?? null;
      }
      return out;
    };
    const pick = (where: Row, include?: Row) => withInclude(rows().find((r) => matches(r, where)) ?? null, include);
    const api = {
      findUnique: async ({ where, include }: { where: Row; include?: Row }) => pick(where, include),
      findUniqueOrThrow: async ({ where }: { where: Row }) => {
        const r = pick(where);
        if (!r) throw Object.assign(new Error('Not found'), { code: 'P2025' });
        return r;
      },
      findFirst: async ({ where, orderBy, include }: { where?: Row; orderBy?: Row | Row[]; include?: Row } = {}) => {
        const list = rows().filter((r) => matches(r, where));
        return withInclude(sort(list, orderBy)[0] ?? null, include);
      },
      findFirstOrThrow: async (a: any) => {
        const r = await api.findFirst(a);
        if (!r) throw Object.assign(new Error('Not found'), { code: 'P2025' });
        return r;
      },
      findMany: async ({ where, orderBy, take, skip }: { where?: Row; orderBy?: Row | Row[]; take?: number; skip?: number } = {}) => {
        let list = sort(rows().filter((r) => matches(r, where)), orderBy);
        if (skip) list = list.slice(skip);
        if (take !== undefined) list = list.slice(0, take);
        return list;
      },
      count: async ({ where }: { where?: Row } = {}) => rows().filter((r) => matches(r, where)).length,
      create: async ({ data }: { data: Row }) => {
        const row = { id: crypto.randomBytes(12).toString('hex'), createdAt: new Date(), updatedAt: new Date(), ...(this.defaults[name] ?? {}), ...stripNested(data) };
        this.checkUnique(name, row);
        rows().push(row);
        return row;
      },
      createMany: async ({ data }: { data: Row[] }) => {
        for (const d of data) await api.create({ data: d });
        return { count: data.length };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = pick(where);
        if (!r) throw Object.assign(new Error('Record to update not found'), { code: 'P2025' });
        const next = { ...r };
        applyData(next, stripNested(data));
        this.checkUnique(name, next, r);
        Object.assign(r, next);
        return r;
      },
      updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
        const hit = rows().filter((r) => matches(r, where));
        for (const r of hit) applyData(r, stripNested(data));
        return { count: hit.length };
      },
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const r = pick(where);
        return r ? api.update({ where, data: update }) : api.create({ data: create });
      },
      delete: async ({ where }: { where: Row }) => {
        const r = pick(where);
        if (!r) throw Object.assign(new Error('not found'), { code: 'P2025' });
        rows().splice(rows().indexOf(r), 1);
        return r;
      },
      deleteMany: async ({ where }: { where?: Row } = {}) => {
        const keep = rows().filter((r) => !matches(r, where));
        const count = rows().length - keep.length;
        this.tables.set(name, keep);
        return { count };
      },
      groupBy: async ({ by, where, _sum }: { by: string[]; where?: Row; _sum?: Row }) => {
        const groups = new Map<string, Row[]>();
        for (const r of rows().filter((x) => matches(x, where))) {
          const key = by.map((f) => String(r[f])).join('|');
          groups.set(key, [...(groups.get(key) ?? []), r]);
        }
        return [...groups.values()].map((list) => {
          const out: Row = {};
          for (const f of by) out[f] = list[0][f];
          out._sum = {};
          for (const f of Object.keys(_sum ?? {})) out._sum[f] = list.reduce((a, r) => a + (r[f] ?? 0), typeof list[0][f] === 'bigint' ? 0n : 0);
          return out;
        });
      },
      aggregate: async ({ where, _sum }: { where?: Row; _sum?: Row }) => {
        const list = rows().filter((r) => matches(r, where));
        const out: Row = {};
        for (const f of Object.keys(_sum ?? {})) out[f] = list.reduce((a, r) => a + (r[f] ?? 0), typeof list[0]?.[f] === 'bigint' ? 0n : 0);
        return { _sum: out };
      },
    };
    return api;
  }

  async $transaction(arg: any) {
    return typeof arg === 'function' ? arg(this) : Promise.all(arg);
  }
  async $disconnect() {}
}

function stripNested(data: Row): Row {
  // Relation writes (connect/create) are not modelled; plain scalars only.
  const out: Row = {};
  for (const [k, v] of Object.entries(data)) if (!(isPlain(v) && ('connect' in v || 'connectOrCreate' in v))) out[k] = v;
  return out;
}

function sort(list: Row[], orderBy?: Row | Row[]): Row[] {
  const keys = ([] as Row[]).concat(orderBy ?? []);
  if (!keys.length) return [...list];
  return [...list].sort((a, b) => {
    for (const o of keys) {
      const [f, dir] = Object.entries(o)[0] as [string, 'asc' | 'desc'];
      const x = val(a[f]);
      const y = val(b[f]);
      if (x === y) continue;
      return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

export const UNIQUES: Record<string, string[][]> = {
  user: [['id'], ['email']],
  swapOffer: [['id']],
  authSession: [['refreshTokenHash']],
  offerReservation: [['swapId']],
  swapEvent: [['dedupeKey']],
  stripeWebhookEvent: [['stripeEventId']],
  payment: [['idempotencyKey'], ['stripeCheckoutSessionId']],
  ledgerEntry: [['reference']],
  verifiedPhone: [['phone']],
};

/** Prisma `@default(...)` values the services rely on. */
export const DEFAULTS: Record<string, Row> = {
  offerReservation: { status: 'HELD' },
  payment: { status: 'REQUIRES_PAYMENT' },
  stripeWebhookEvent: { status: 'PROCESSING', attempts: 1, get receivedAt() { return new Date(); } },
  swap: { status: 'PENDING', initiatorConfirmed: false, receiverConfirmed: false, remindersSent: 0 },
  notification: { isRead: false },
  otpChallenge: { attempts: 0, consumedAt: null },
  authSession: { revokedAt: null, rotatedAt: null, get lastUsedAt() { return new Date(); } },
};

export const newDb = () => new FakeDb(UNIQUES, DEFAULTS);
