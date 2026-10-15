import type { Request } from 'express';
import type { SessionMeta } from '@/services/session.service';

export const sessionMeta = (req: Request): SessionMeta => ({
  deviceId: typeof req.body?.deviceId === 'string' ? req.body.deviceId : (req.get('x-device-id') ?? null),
  deviceName: typeof req.body?.deviceName === 'string' ? req.body.deviceName : (req.get('x-device-name') ?? null),
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const uid = (req: Request): string => req.user!.userId;
