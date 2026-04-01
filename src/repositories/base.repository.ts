// src/repositories/base.repository.ts
import { prisma } from '@/config/database';

export abstract class BaseRepository<T> {
  protected abstract model: string;

  protected get db() {
    return (prisma as unknown as Record<string, unknown>)[this.model] as {
      findUnique: (...a: unknown[]) => Promise<T | null>;
      findMany:   (...a: unknown[]) => Promise<T[]>;
      create:     (...a: unknown[]) => Promise<T>;
      update:     (...a: unknown[]) => Promise<T>;
      delete:     (...a: unknown[]) => Promise<T>;
      count:      (...a: unknown[]) => Promise<number>;
    };
  }

  async findById(id: string): Promise<T | null> {
    return this.db.findUnique({ where: { id } });
  }

  async count(where?: object): Promise<number> {
    return this.db.count({ where });
  }
}
