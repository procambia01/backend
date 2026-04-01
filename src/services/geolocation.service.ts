// src/services/geolocation.service.ts
export class GeolocationService {
  /**
   * Calculate distance between two coordinates (Haversine formula) in km
   */
  calculateDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number,
  ): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Build a bounding box for a radius search (approx.)
   */
  getBoundingBox(lat: number, lon: number, radiusKm: number) {
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / (111 * Math.cos(this.toRad(lat)));
    return {
      minLat: lat - latDelta,
      maxLat: lat + latDelta,
      minLon: lon - lonDelta,
      maxLon: lon + lonDelta,
    };
  }

  /**
   * Filter and sort items by distance from a point
   */
  sortByDistance<T extends { latitude: number | null; longitude: number | null }>(
    items: T[],
    lat: number,
    lon: number,
  ): (T & { distance: number })[] {
    return items
      .filter(i => i.latitude != null && i.longitude != null)
      .map(i => ({
        ...i,
        distance: this.calculateDistance(lat, lon, i.latitude!, i.longitude!),
      }))
      .sort((a, b) => a.distance - b.distance);
  }
}
