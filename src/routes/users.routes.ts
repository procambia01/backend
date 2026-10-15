import { Router, z, h, ok, created, paged, idParams, pageQ, pageOf, param, file } from './_h';
import { AuthMiddleware as Auth } from '@/middleware/auth.middleware';
import { RateLimitMiddleware as RL } from '@/middleware/rateLimit.middleware';
import { validateBody, validateParams, validateQuery } from '@/middleware/validate.middleware';
import { uploadSingle } from '@/middleware/upload.middleware';
import { updateProfileSchema, latitude, longitude, phoneOtpRequestSchema, phoneOtpVerifySchema } from '@/contracts';
import { uid } from '@/lib/http';
import { userService } from '@/services/user.service';
import { phoneService } from '@/services/phone.service';
import { locationService } from '@/services/location.service';
import { businessService } from '@/services/business.service';
import { UploadInvalidError } from '@/utils/error.util';

const router = Router();

const prefsSchema = z.object({
  darkMode: z.boolean().optional(),
  receiveEmails: z.boolean().optional(),
  receiveSMS: z.boolean().optional(),
  receivePush: z.boolean().optional(),
  notificationPreferences: z.record(z.boolean()).optional(),
  preferredMeetingPlaces: z.array(z.string().max(120)).max(10).optional(),
});
const locationSchema = z.object({
  latitude, longitude,
  city: z.string().trim().min(2).max(100),
  country: z.string().length(2).toUpperCase(),
  state: z.string().trim().max(100).optional(),
});
const savedLocation = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().min(2).max(200),
  latitude, longitude,
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().max(100).optional(),
  country: z.string().length(2).toUpperCase(),
  placeId: z.string().max(200).optional(),
  category: z.string().max(40).optional(),
  isPrimary: z.boolean().optional(),
});
const pushSchema = z.object({ token: z.string().min(10).max(400), platform: z.enum(['ios', 'android', 'web']), deviceId: z.string().max(128).optional() });
const blockSchema = z.object({ reason: z.string().trim().max(300).optional() });
const favSchema = z.object({ notes: z.string().trim().max(300).optional() });
const businessProfile = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradingName: z.string().trim().max(200).optional(),
  country: z.string().length(2).toUpperCase(),
  registrationNumber: z.string().trim().max(100).optional(),
  website: z.string().url().optional(),
  description: z.string().trim().max(1000).optional(),
});
const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['MEMBER', 'MANAGER']).default('MEMBER') });
const respondSchema = z.object({ accept: z.boolean() });
const memberParams = z.object({ memberId: z.string().regex(/^[a-f0-9]{24}$/i) });
const targetParams = z.object({ userId: z.string().regex(/^[a-f0-9]{24}$/i) });

// ── public profile ──
router.get('/:id/public', Auth.optionalAuth, validateParams(idParams), h(async (req, res) => ok(res, await userService.publicProfile(req.user?.userId, param(req)))));

router.use(Auth.authenticate);

// ── own account ──
router.patch('/me', validateBody(updateProfileSchema), h(async (req, res) => ok(res, await userService.updateProfile(uid(req), req.body))));
router.patch('/me/preferences', validateBody(prefsSchema), h(async (req, res) => ok(res, await userService.updatePreferences(uid(req), req.body))));
router.put('/me/location', validateBody(locationSchema), h(async (req, res) => ok(res, await userService.setLocation(uid(req), req.body))));
router.post('/me/avatar', RL.upload, uploadSingle('avatar'), h(async (req, res) => {
  const f = file(req);
  if (!f) throw new UploadInvalidError('An image file is required');
  ok(res, await userService.setAvatar(uid(req), f));
}));
router.get('/me/entitlements', h(async (req, res) => ok(res, await userService.entitlements(uid(req)))));
router.get('/me/activity', validateQuery(pageQ), h(async (req, res) => { const { page, perPage } = pageOf(req); paged(res, await userService.activity(uid(req), page, perPage), page, perPage); }));
router.delete('/me', Auth.requireRecentAuth, h(async (req, res) => { await userService.deleteAccount(uid(req)); ok(res, { deleted: true }); }));

// ── phone verification ──
router.post('/me/phone/request-otp', RL.otpRequest, validateBody(phoneOtpRequestSchema), h(async (req, res) => ok(res, await phoneService.requestOtp(uid(req), req.body.phone))));
router.post('/me/phone/verify-otp', RL.otpVerify, validateBody(phoneOtpVerifySchema), h(async (req, res) => { await phoneService.verifyOtp(uid(req), req.body.code); ok(res, { verified: true }); }));

// ── push tokens ──
router.post('/me/push-tokens', validateBody(pushSchema), h(async (req, res) => { await userService.registerPushToken(uid(req), req.body.token, req.body.platform, req.body.deviceId); created(res, { registered: true }); }));
router.delete('/me/push-tokens', validateBody(z.object({ token: z.string().min(10) })), h(async (req, res) => { await userService.removePushToken(uid(req), req.body.token); ok(res, { removed: true }); }));

// ── blocks and favourites ──
router.get('/me/blocked', h(async (req, res) => ok(res, await userService.blocked(uid(req)))));
router.post('/me/blocked/:userId', validateParams(targetParams), validateBody(blockSchema), h(async (req, res) => { await userService.block(uid(req), param(req, 'userId'), req.body.reason); created(res, { blocked: true }); }));
router.delete('/me/blocked/:userId', validateParams(targetParams), h(async (req, res) => { await userService.unblock(uid(req), param(req, 'userId')); ok(res, { blocked: false }); }));
router.get('/me/favorites', h(async (req, res) => ok(res, await userService.favorites(uid(req)))));
router.post('/me/favorites/:userId', validateParams(targetParams), validateBody(favSchema), h(async (req, res) => { await userService.favorite(uid(req), param(req, 'userId'), req.body.notes); created(res, { favorite: true }); }));
router.delete('/me/favorites/:userId', validateParams(targetParams), h(async (req, res) => { await userService.unfavorite(uid(req), param(req, 'userId')); ok(res, { favorite: false }); }));

// ── saved places ──
router.get('/me/locations', h(async (req, res) => ok(res, await locationService.list(uid(req)))));
router.post('/me/locations', validateBody(savedLocation), h(async (req, res) => created(res, await locationService.create(uid(req), req.body))));
router.patch('/me/locations/:id', validateParams(idParams), validateBody(savedLocation.partial()), h(async (req, res) => ok(res, await locationService.update(uid(req), param(req), req.body))));
router.delete('/me/locations/:id', validateParams(idParams), h(async (req, res) => { await locationService.remove(uid(req), param(req)); ok(res, { removed: true }); }));

// ── business profile and team ──
router.get('/me/business', h(async (req, res) => ok(res, await businessService.getProfile(uid(req)))));
router.put('/me/business', validateBody(businessProfile), h(async (req, res) => ok(res, await businessService.upsertProfile(uid(req), req.body))));
router.get('/me/business/team', h(async (req, res) => ok(res, await businessService.team(uid(req)))));
router.post('/me/business/team', validateBody(inviteSchema), h(async (req, res) => created(res, await businessService.invite(uid(req), req.body.email, req.body.role))));
router.delete('/me/business/team/:memberId', validateParams(memberParams), h(async (req, res) => { await businessService.removeMember(uid(req), param(req, 'memberId')); ok(res, { removed: true }); }));
router.post('/me/business/invitations/:ownerId', validateParams(z.object({ ownerId: z.string().regex(/^[a-f0-9]{24}$/i) })), validateBody(respondSchema), h(async (req, res) => { await businessService.respond(uid(req), param(req, 'ownerId'), req.body.accept); ok(res, { accepted: req.body.accept }); }));
router.delete('/me/business/memberships/:ownerId', validateParams(z.object({ ownerId: z.string().regex(/^[a-f0-9]{24}$/i) })), h(async (req, res) => { await businessService.leave(uid(req), param(req, 'ownerId')); ok(res, { left: true }); }));

export default router;
