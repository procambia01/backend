import { toPublicArea, haversineKm, bucketDistanceKm, isValidLatLng, boundingBox } from '@/lib/geo';

const paris = { latitude: 48.85661, longitude: 2.35222 };

describe('location privacy', () => {
  it('public area is deterministic per entity but differs from the exact point', () => {
    const a = toPublicArea(paris, 'offer-1');
    expect(toPublicArea(paris, 'offer-1')).toEqual(a);
    const [lng, lat] = a.coordinates;
    expect(lat).not.toBe(paris.latitude);
    expect(lng).not.toBe(paris.longitude);
  });
  it('never reveals the exact coordinates, and stays within ~1.5 km', () => {
    for (let i = 0; i < 50; i++) {
      const p = toPublicArea({ latitude: 48.85661 + i * 1e-5, longitude: 2.35222 - i * 1e-5 }, `o-${i}`);
      const km = haversineKm({ latitude: 48.85661 + i * 1e-5, longitude: 2.35222 - i * 1e-5 }, { latitude: p.coordinates[1], longitude: p.coordinates[0] });
      expect(km).toBeLessThan(1.5);
      expect(km).toBeGreaterThan(0.001);
    }
  });
  it('different entities at the same spot get different public points (no averaging back)', () => {
    expect(toPublicArea(paris, 'a').coordinates).not.toEqual(toPublicArea(paris, 'b').coordinates);
  });
  it('buckets distances so exact figures are never shown', () => {
    expect(bucketDistanceKm(0.2)).toBe(1);
    expect(bucketDistanceKm(3.2)).toBe(4);
    expect(bucketDistanceKm(7.1)).toBe(10);
    expect(bucketDistanceKm(33)).toBe(40);
  });
  it('validates coordinates', () => {
    expect(isValidLatLng(paris)).toBe(true);
    expect(isValidLatLng({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidLatLng({ latitude: 0, longitude: NaN })).toBe(false);
  });
  it('haversine: Paris ↔ London ≈ 344 km', () => {
    expect(haversineKm(paris, { latitude: 51.5072, longitude: -0.1276 })).toBeGreaterThan(335);
    expect(haversineKm(paris, { latitude: 51.5072, longitude: -0.1276 })).toBeLessThan(350);
  });
  it('bounding box contains the centre', () => {
    const b = boundingBox(paris, 10);
    expect(b.minLat).toBeLessThan(paris.latitude);
    expect(b.maxLng).toBeGreaterThan(paris.longitude);
  });
});
