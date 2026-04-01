import { getDistance, isPointWithinRadius, getBounds, convertDistance } from 'geolib';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export class DistanceUtil {
  /**
   * Calculate distance between two points in meters
   */
  static calculateDistance(point1: Coordinates, point2: Coordinates): number {
    return getDistance(
      { latitude: point1.latitude, longitude: point1.longitude },
      { latitude: point2.latitude, longitude: point2.longitude }
    );
  }

  /**
   * Calculate distance in kilometers
   */
  static calculateDistanceInKm(point1: Coordinates, point2: Coordinates): number {
    const distanceInMeters = this.calculateDistance(point1, point2);
    return convertDistance(distanceInMeters, 'km');
  }

  /**
   * Calculate distance in miles
   */
  static calculateDistanceInMiles(point1: Coordinates, point2: Coordinates): number {
    const distanceInMeters = this.calculateDistance(point1, point2);
    return convertDistance(distanceInMeters, 'mi');
  }

  /**
   * Check if a point is within radius of another point
   */
  static isWithinRadius(
    center: Coordinates,
    point: Coordinates,
    radiusInKm: number
  ): boolean {
    return isPointWithinRadius(
      { latitude: point.latitude, longitude: point.longitude },
      { latitude: center.latitude, longitude: center.longitude },
      radiusInKm * 1000 // Convert km to meters
    );
  }

  /**
   * Get bounding box for a given center and radius
   */
  static getBoundingBox(center: Coordinates, radiusInKm: number): BoundingBox {
    const latOffset = radiusInKm / 111; // Approximate km per degree latitude
    const lngOffset = radiusInKm / (111 * Math.cos(this.degreesToRadians(center.latitude)));

    return {
      minLat: center.latitude - latOffset,
      maxLat: center.latitude + latOffset,
      minLng: center.longitude - lngOffset,
      maxLng: center.longitude + lngOffset,
    };
  }

  /**
   * Format distance for display
   */
  static formatDistance(distanceInMeters: number, unit: 'km' | 'mi' = 'km'): string {
    if (unit === 'km') {
      const km = distanceInMeters / 1000;
      if (km < 1) {
        return `${Math.round(distanceInMeters)} m`;
      }
      return `${km.toFixed(1)} km`;
    } else {
      const miles = convertDistance(distanceInMeters, 'mi');
      if (miles < 0.1) {
        const feet = Math.round(distanceInMeters * 3.28084);
        return `${feet} ft`;
      }
      return `${miles.toFixed(1)} mi`;
    }
  }

  /**
   * Get MongoDB geospatial query for nearby locations
   */
  static getNearbyQuery(
    center: Coordinates,
    radiusInKm: number
  ): {
    latitude: { $gte: number; $lte: number };
    longitude: { $gte: number; $lte: number };
  } {
    const bounds = this.getBoundingBox(center, radiusInKm);

    return {
      latitude: {
        $gte: bounds.minLat,
        $lte: bounds.maxLat,
      },
      longitude: {
        $gte: bounds.minLng,
        $lte: bounds.maxLng,
      },
    };
  }

  /**
   * Sort locations by distance from a point
   */
  static sortByDistance<T extends Coordinates>(
    locations: T[],
    center: Coordinates,
    ascending: boolean = true
  ): T[] {
    return locations.sort((a, b) => {
      const distanceA = this.calculateDistance(center, a);
      const distanceB = this.calculateDistance(center, b);
      return ascending ? distanceA - distanceB : distanceB - distanceA;
    });
  }

  /**
   * Filter locations within radius
   */
  static filterByRadius<T extends Coordinates>(
    locations: T[],
    center: Coordinates,
    radiusInKm: number
  ): T[] {
    return locations.filter(location =>
      this.isWithinRadius(center, location, radiusInKm)
    );
  }

  /**
   * Get the closest location
   */
  static getClosest<T extends Coordinates>(
    locations: T[],
    center: Coordinates
  ): T | null {
    if (locations.length === 0) return null;

    return locations.reduce((closest, current) => {
      const closestDistance = this.calculateDistance(center, closest);
      const currentDistance = this.calculateDistance(center, current);
      return currentDistance < closestDistance ? current : closest;
    });
  }

  /**
   * Calculate center point (centroid) of multiple locations
   */
  static getCenterPoint(locations: Coordinates[]): Coordinates | null {
    if (locations.length === 0) return null;

    const sum = locations.reduce(
      (acc, loc) => ({
        latitude: acc.latitude + loc.latitude,
        longitude: acc.longitude + loc.longitude,
      }),
      { latitude: 0, longitude: 0 }
    );

    return {
      latitude: sum.latitude / locations.length,
      longitude: sum.longitude / locations.length,
    };
  }

  /**
   * Validate coordinates
   */
  static isValidCoordinates(coords: Coordinates): boolean {
    const { latitude, longitude } = coords;
    return (
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  /**
   * Convert degrees to radians
   */
  static degreesToRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Convert radians to degrees
   */
  static radiansToDegrees(radians: number): number {
    return radians * (180 / Math.PI);
  }

  /**
   * Calculate bearing between two points
   */
  static calculateBearing(start: Coordinates, end: Coordinates): number {
    const startLat = this.degreesToRadians(start.latitude);
    const startLng = this.degreesToRadians(start.longitude);
    const endLat = this.degreesToRadians(end.latitude);
    const endLng = this.degreesToRadians(end.longitude);

    const y = Math.sin(endLng - startLng) * Math.cos(endLat);
    const x =
      Math.cos(startLat) * Math.sin(endLat) -
      Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLng - startLng);

    const bearing = this.radiansToDegrees(Math.atan2(y, x));
    return (bearing + 360) % 360; // Normalize to 0-360
  }

  /**
   * Get compass direction from bearing
   */
  static getCompassDirection(bearing: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
  }

  /**
   * Calculate destination point given distance and bearing
   */
  static calculateDestination(
    start: Coordinates,
    distanceInKm: number,
    bearing: number
  ): Coordinates {
    const R = 6371; // Earth's radius in km
    const d = distanceInKm / R;
    const brng = this.degreesToRadians(bearing);
    const lat1 = this.degreesToRadians(start.latitude);
    const lng1 = this.degreesToRadians(start.longitude);

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
    );

    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
      );

    return {
      latitude: this.radiansToDegrees(lat2),
      longitude: this.radiansToDegrees(lng2),
    };
  }
}

export default DistanceUtil;