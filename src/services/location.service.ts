// src/services/location.service.ts
import { prisma } from '@/config/database';
import { NotFoundError, ForbiddenError, BadRequestError } from '@/utils/error.util';
import logger from '@/utils/logger.util';

export class LocationService {
  /**
   * Save a new location for a user
   */
  async saveLocation(userId: string, locationData: any) {
    // Validate required fields
    if (!locationData.name || !locationData.address || !locationData.latitude || !locationData.longitude) {
      throw new BadRequestError('Name, address, latitude, and longitude are required');
    }

    // If this is marked as primary, unset other primary locations
    if (locationData.isPrimary) {
      await prisma.savedLocation.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const location = await prisma.savedLocation.create({
      data: {
        userId,
        name: locationData.name,
        address: locationData.address,
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        city: locationData.city,
        state: locationData.state,
        country: locationData.country,
        placeId: locationData.placeId,
        isPrimary: locationData.isPrimary || false,
        isPublic: locationData.isPublic !== undefined ? locationData.isPublic : true,
        category: locationData.category,
      },
    });

    logger.info(`Location saved: ${location.id} for user ${userId}`);

    return location;
  }

  /**
   * Get all saved locations for a user
   */
  async getSavedLocations(userId: string) {
    const locations = await prisma.savedLocation.findMany({
      where: { userId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });

    return locations;
  }

  /**
   * Get a single location by ID
   */
  async getLocationById(locationId: string, userId: string) {
    const location = await prisma.savedLocation.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      throw new NotFoundError('Location not found');
    }

    if (location.userId !== userId) {
      throw new ForbiddenError('You do not have access to this location');
    }

    return location;
  }

  /**
   * Update a saved location
   */
  async updateLocation(locationId: string, userId: string, updateData: any) {
    const location = await prisma.savedLocation.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      throw new NotFoundError('Location not found');
    }

    if (location.userId !== userId) {
      throw new ForbiddenError('You can only update your own locations');
    }

    // If setting as primary, unset other primary locations
    if (updateData.isPrimary) {
      await prisma.savedLocation.updateMany({
        where: { 
          userId, 
          isPrimary: true,
          id: { not: locationId }
        },
        data: { isPrimary: false },
      });
    }

    const updatedLocation = await prisma.savedLocation.update({
      where: { id: locationId },
      data: {
        name: updateData.name,
        address: updateData.address,
        latitude: updateData.latitude,
        longitude: updateData.longitude,
        city: updateData.city,
        state: updateData.state,
        country: updateData.country,
        placeId: updateData.placeId,
        isPrimary: updateData.isPrimary,
        isPublic: updateData.isPublic,
        category: updateData.category,
      },
    });

    logger.info(`Location updated: ${locationId} by user ${userId}`);

    return updatedLocation;
  }

  /**
   * Delete a saved location
   */
  async deleteLocation(locationId: string, userId: string) {
    const location = await prisma.savedLocation.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      throw new NotFoundError('Location not found');
    }

    if (location.userId !== userId) {
      throw new ForbiddenError('You can only delete your own locations');
    }

    await prisma.savedLocation.delete({
      where: { id: locationId },
    });

    logger.info(`Location deleted: ${locationId} by user ${userId}`);
  }

  /**
   * Set a location as primary
   */
  async setPrimaryLocation(locationId: string, userId: string) {
    const location = await prisma.savedLocation.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      throw new NotFoundError('Location not found');
    }

    if (location.userId !== userId) {
      throw new ForbiddenError('You can only set your own locations as primary');
    }

    // Unset all other primary locations for this user
    await prisma.savedLocation.updateMany({
      where: { 
        userId, 
        isPrimary: true,
        id: { not: locationId }
      },
      data: { isPrimary: false },
    });

    // Set this location as primary
    await prisma.savedLocation.update({
      where: { id: locationId },
      data: { isPrimary: true },
    });

    logger.info(`Primary location set: ${locationId} for user ${userId}`);
  }

  /**
   * Get public locations near a coordinate
   */
  async getNearbyPublicLocations(
    latitude: number,
    longitude: number,
    radiusKm: number = 10
  ) {
    // Calculate rough bounding box
    const latOffset = radiusKm / 111; // ~111km per degree latitude
    const lngOffset = radiusKm / (111 * Math.cos(latitude * (Math.PI / 180)));

    const locations = await prisma.savedLocation.findMany({
      where: {
        isPublic: true,
        latitude: {
          gte: latitude - latOffset,
          lte: latitude + latOffset,
        },
        longitude: {
          gte: longitude - lngOffset,
          lte: longitude + lngOffset,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            rating: true,
          },
        },
      },
    });

    // Filter by actual distance using Haversine formula
    const nearbyLocations = locations.filter(loc => {
      const distance = this.calculateDistance(
        latitude,
        longitude,
        loc.latitude,
        loc.longitude
      );
      return distance <= radiusKm;
    });

    return nearbyLocations;
  }

  /**
   * Get popular meeting places in a city
   */
  async getPopularLocations(city: string, limit: number = 10) {
    const locations = await prisma.savedLocation.findMany({
      where: {
        city: {
          equals: city,
          mode: 'insensitive',
        },
        isPublic: true,
      },
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            rating: true,
          },
        },
      },
    });

    return locations;
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Radius of the Earth in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance;
  }

  /**
   * Convert degrees to radians
   */
  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Search locations by name or address
   */
  async searchLocations(userId: string, searchTerm: string) {
    const locations = await prisma.savedLocation.findMany({
      where: {
        userId,
        OR: [
          {
            name: {
              contains: searchTerm,
              mode: 'insensitive',
            },
          },
          {
            address: {
              contains: searchTerm,
              mode: 'insensitive',
            },
          },
          {
            city: {
              contains: searchTerm,
              mode: 'insensitive',
            },
          },
        ],
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });

    return locations;
  }

  /**
   * Get locations by category
   */
  async getLocationsByCategory(userId: string, category: string) {
    const locations = await prisma.savedLocation.findMany({
      where: {
        userId,
        category: {
          equals: category,
          mode: 'insensitive',
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });

    return locations;
  }

  /**
   * Get primary location
   */
  async getPrimaryLocation(userId: string) {
    const location = await prisma.savedLocation.findFirst({
      where: {
        userId,
        isPrimary: true,
      },
    });

    return location;
  }

  /**
   * Bulk create locations
   */
  async bulkCreateLocations(userId: string, locations: any[]) {
    const createdLocations = await prisma.savedLocation.createMany({
      data: locations.map(loc => ({
        userId,
        name: loc.name,
        address: loc.address,
        latitude: loc.latitude,
        longitude: loc.longitude,
        city: loc.city,
        state: loc.state,
        country: loc.country,
        placeId: loc.placeId,
        isPrimary: false,
        isPublic: loc.isPublic !== undefined ? loc.isPublic : true,
        category: loc.category,
      })),
    });

    logger.info(`Bulk locations created: ${createdLocations.count} for user ${userId}`);

    return createdLocations;
  }
}