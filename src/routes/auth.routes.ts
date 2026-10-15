import { Router } from 'express';
import { z } from 'zod';
import { authController as c } from '@/controllers/auth.controller';
import { AuthMiddleware as Auth } from '@/middleware/auth.middleware';
import { RateLimitMiddleware as RL } from '@/middleware/rateLimit.middleware';
import { validateBody } from '@/middleware/validate.middleware';
import { asyncHandler } from '@/middleware/error.middleware';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  reauthSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from '@/contracts';

const router = Router();
const tokenSchema = z.object({ token: z.string().min(10).max(200) });
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const disable2fa = z.object({ password: z.string().min(1), code: z.string().regex(/^\d{6}$|^[A-Za-z0-9]{10}$/) });

router.post('/register', RL.register, validateBody(registerSchema), asyncHandler(c.register));
router.post('/login', RL.loginByIp, RL.login, validateBody(loginSchema), asyncHandler(c.login));
router.post('/refresh', RL.refresh, validateBody(refreshSchema), asyncHandler(c.refresh));
router.post('/forgot-password', RL.passwordReset, validateBody(forgotPasswordSchema), asyncHandler(c.forgotPassword));
router.post('/reset-password', RL.passwordReset, validateBody(resetPasswordSchema), asyncHandler(c.resetPassword));
router.post('/verify-email', RL.emailVerification, validateBody(tokenSchema), asyncHandler(c.verifyEmail));

router.use(Auth.authenticate);
router.get('/me', asyncHandler(c.me));
router.post('/logout', asyncHandler(c.logout));
router.post('/logout-all', asyncHandler(c.logoutAll));
router.post('/resend-verification', RL.emailVerification, asyncHandler(c.resendVerification));
router.post('/reauth', RL.reauth, validateBody(reauthSchema), asyncHandler(c.reauthenticate));
router.post('/change-password', Auth.requireRecentAuth, validateBody(changePasswordSchema), asyncHandler(c.changePassword));
router.get('/sessions', asyncHandler(c.sessions));
router.delete('/sessions/:id', Auth.requireRecentAuth, asyncHandler(c.revokeSession));

router.post('/2fa/setup', RL.twoFactor, Auth.requireRecentAuth, asyncHandler(c.twoFactorSetup));
router.post('/2fa/enable', RL.twoFactor, Auth.requireRecentAuth, validateBody(codeSchema), asyncHandler(c.twoFactorEnable));
router.post('/2fa/disable', RL.twoFactor, Auth.requireRecentAuth, validateBody(disable2fa), asyncHandler(c.twoFactorDisable));

export default router;
