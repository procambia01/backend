import type { User } from '@prisma/client';
import type { MeDto, PublicUserDto } from '@/contracts';
import { effectivePlan, isPremium } from '@/lib/entitlements';

export function completionRate(u: Pick<User, 'totalSwaps' | 'successfulSwaps'>): number {
  return u.totalSwaps > 0 ? Math.round((u.successfulSwaps / u.totalSwaps) * 100) : 0;
}

export function toMe(u: User): MeDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    image: u.image,
    role: u.role,
    phone: u.phone,
    phoneVerified: u.phoneVerified,
    emailVerified: u.emailVerified,
    twoFactorEnabled: u.twoFactorEnabled,
    verificationStatus: u.verificationStatus,
    verificationTier: u.verificationTier,
    idVerified: u.idVerified,
    businessVerified: u.businessVerified,
    planTier: effectivePlan(u),
    planExpiresAt: u.planExpiresAt ? u.planExpiresAt.toISOString() : null,
    isPremium: isPremium(u),
    country: u.country,
    city: u.city,
    languagePreference: u.languagePreference,
    timezone: u.timezone,
    preferredCurrencies: u.preferredCurrencies,
    receiveEmails: u.receiveEmails,
    receiveSMS: u.receiveSMS,
    receivePush: u.receivePush,
    rating: u.rating,
    totalSwaps: u.totalSwaps,
    successfulSwaps: u.successfulSwaps,
    trustScore: u.trustScore,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Only fields safe to show to other marketplace users. No email, phone, exact location or KYC detail. */
export function toPublicUser(u: User): PublicUserDto {
  return {
    id: u.id,
    name: u.name,
    image: u.image,
    city: u.city,
    country: u.country,
    memberSince: u.createdAt.toISOString(),
    rating: u.rating,
    totalSwaps: u.totalSwaps,
    successfulSwaps: u.successfulSwaps,
    completionRate: completionRate(u),
    trustScore: u.trustScore,
    verified: u.idVerified && u.verificationStatus === 'VERIFIED',
    businessVerified: u.businessVerified,
    premiumBadge: isPremium(u),
  };
}
