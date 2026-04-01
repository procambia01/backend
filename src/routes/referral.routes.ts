import { Router as ReferralRouter } from 'express';
import { ReferralController } from '@/controllers/referral.controller';
import { authenticate } from '@/middleware/auth.middleware';
import { asyncHandler } from '@/middleware/error.middleware';

const referralRouter = ReferralRouter();
const referralController = new ReferralController();

referralRouter.get('/my-code', authenticate, asyncHandler(referralController.getMyReferralCode));
referralRouter.get('/stats', authenticate, asyncHandler(referralController.getReferralStats));
referralRouter.get('/referred-users', authenticate, asyncHandler(referralController.getReferredUsers));
referralRouter.post('/validate/:code', asyncHandler(referralController.validateReferralCode));

export { referralRouter as default };

