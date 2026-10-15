import { prisma } from '@/config/database';
import { toGeoPoint, fromGeoPoint } from '@/lib/geo';
import { ConflictError, NotFoundError } from '@/utils/error.util';

export interface SavedLocationInput {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  city: string;
  state?: string;
  country: string;
  placeId?: string;
  category?: string;
  isPrimary?: boolean;
}

const MAX_SAVED = 20;

/** Saved places belong to the user and are never shown to anyone else. */
export class LocationService {
  private dto(l: Awaited<ReturnType<typeof prisma.savedLocation.findFirstOrThrow>>) {
    const p = fromGeoPoint(l.location);
    return { id: l.id, name: l.name, address: l.address, latitude: p?.latitude ?? 0, longitude: p?.longitude ?? 0, city: l.city, state: l.state, country: l.country, placeId: l.placeId, category: l.category, isPrimary: l.isPrimary };
  }

  async list(userId: string) {
    return (await prisma.savedLocation.findMany({ where: { userId }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }] })).map((l) => this.dto(l));
  }

  async create(userId: string, input: SavedLocationInput) {
    if ((await prisma.savedLocation.count({ where: { userId } })) >= MAX_SAVED) throw new ConflictError('Saved location limit reached');
    if (input.isPrimary) await prisma.savedLocation.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } });
    const l = await prisma.savedLocation.create({
      data: { userId, name: input.name, address: input.address, location: toGeoPoint(input), city: input.city, state: input.state, country: input.country, placeId: input.placeId, category: input.category, isPrimary: !!input.isPrimary },
    });
    return this.dto(l);
  }

  async update(userId: string, id: string, input: Partial<SavedLocationInput>) {
    const cur = await prisma.savedLocation.findFirst({ where: { id, userId } });
    if (!cur) throw new NotFoundError('Location not found');
    if (input.isPrimary) await prisma.savedLocation.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } });
    const hasPos = input.latitude !== undefined && input.longitude !== undefined;
    const l = await prisma.savedLocation.update({
      where: { id },
      data: { name: input.name, address: input.address, city: input.city, state: input.state, country: input.country, placeId: input.placeId, category: input.category, isPrimary: input.isPrimary, ...(hasPos ? { location: toGeoPoint({ latitude: input.latitude!, longitude: input.longitude! }) } : {}) },
    });
    return this.dto(l);
  }

  async remove(userId: string, id: string) {
    const r = await prisma.savedLocation.deleteMany({ where: { id, userId } });
    if (r.count !== 1) throw new NotFoundError('Location not found');
  }
}

export const locationService = new LocationService();
