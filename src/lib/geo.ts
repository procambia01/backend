/**
 * Location privacy.
 *
 *  - `privateLocation` (exact) never leaves the server.
 *  - `publicArea` is what discovery uses: the exact point snapped to a ~1 km
 *    grid and then displaced by a deterministic, per-entity jitter, so the
 *    published point can't be averaged back to the real one and doesn't
 *    change between requests.
 *  - Distances shown to other users are bucketed.
 */
import crypto from 'crypto';

export interface LatLng {
  latitude: number;
  longitude: number;
}
export interface GeoPointValue {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

const GRID_DEG = 0.01; // ≈ 1.1 km
const JITTER_DEG = 0.004; // ≤ ≈ 450 m

export function isValidLatLng(p: LatLng): boolean {
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    p.latitude >= -90 &&
    p.latitude <= 90 &&
    p.longitude >= -180 &&
    p.longitude <= 180
  );
}

export function toGeoPoint(p: LatLng): GeoPointValue {
  return { type: 'Point', coordinates: [round6(p.longitude), round6(p.latitude)] };
}

export function fromGeoPoint(g: { coordinates: number[] } | null | undefined): LatLng | null {
  if (!g || g.coordinates.length < 2) return null;
  return { longitude: g.coordinates[0], latitude: g.coordinates[1] };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Deterministic value in [-1, 1) derived from a seed. */
function seeded(seed: string, salt: string): number {
  const h = crypto.createHash('sha256').update(`${seed}:${salt}`).digest();
  return h.readUInt32BE(0) / 0x100000000 * 2 - 1;
}

/** Coarse, stable public point for an exact location. `seed` = offer/user id. */
export function toPublicArea(exact: LatLng, seed: string): GeoPointValue {
  const snap = (v: number) => Math.round(v / GRID_DEG) * GRID_DEG;
  const lat = clamp(snap(exact.latitude) + seeded(seed, 'lat') * JITTER_DEG, -90, 90);
  const lng = clamp(snap(exact.longitude) + seeded(seed, 'lng') * JITTER_DEG, -180, 180);
  return { type: 'Point', coordinates: [round6(lng), round6(lat)] };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Great-circle distance in km (haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Distance bucket shown to other users, never the precise figure. */
export function bucketDistanceKm(km: number): number {
  if (km < 1) return 1;
  if (km < 5) return Math.ceil(km);
  if (km < 20) return Math.ceil(km / 5) * 5;
  return Math.ceil(km / 10) * 10;
}

/** Bounding box (degrees) around a point, used as a cheap pre-filter. */
export function boundingBox(center: LatLng, radiusKm: number) {
  const dLat = radiusKm / 110.574;
  const dLng = radiusKm / (111.32 * Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180)));
  return {
    minLat: center.latitude - dLat,
    maxLat: center.latitude + dLat,
    minLng: center.longitude - dLng,
    maxLng: center.longitude + dLng,
  };
}
