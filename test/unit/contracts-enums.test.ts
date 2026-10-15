import { NotificationType } from '@prisma/client';
import { NOTIFICATION_TYPES } from '@/contracts';

/** The contract list must mirror the Prisma enum so admin template screens can't drift. */
describe('contract enums', () => {
  it('NOTIFICATION_TYPES matches the Prisma NotificationType enum', () => {
    const prismaValues = Object.keys(NotificationType);
    expect(prismaValues.length).toBeGreaterThan(10);
    expect([...NOTIFICATION_TYPES].sort()).toEqual(prismaValues.sort());
  });
});
