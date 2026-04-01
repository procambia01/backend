import { Router } from 'express';
import { AuthController } from '@/controllers/auth.controller';
import { authenticate, refreshToken } from '@/middleware/auth.middleware';
import { validateBody } from '@/middleware/validate.middleware';
import { 
  loginRateLimit, 
  registerRateLimit, 
  passwordResetRateLimit,
  emailVerificationRateLimit 
} from '@/middleware/rateLimit.middleware';
import {
  registerValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  verifyEmailValidator,
  changePasswordValidator,
  resendVerificationValidator,
} from '@/validators/auth.validator';
import { asyncHandler } from '@/middleware/error.middleware';

const router = Router();
const authController = new AuthController();

// Public routes
/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post(
  '/register',
  registerRateLimit,
  validateBody(registerValidator),
  asyncHandler(authController.register)
);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post(
  '/login',
  loginRateLimit,
  validateBody(loginValidator),
  asyncHandler(authController.login)
);

/**
 * @route   POST /api/v1/auth/refresh-token
 * @desc    Refresh access token
 * @access  Public
 */
router.post('/refresh-token', refreshToken);

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Request password reset
 * @access  Public
 */
router.post(
  '/forgot-password',
  passwordResetRateLimit,
  validateBody(forgotPasswordValidator),
  asyncHandler(authController.forgotPassword)
);

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
router.post(
  '/reset-password',
  validateBody(resetPasswordValidator),
  asyncHandler(authController.resetPassword)
);

/**
 * @route   POST /api/v1/auth/verify-email
 * @desc    Verify email with token
 * @access  Public
 */
router.post(
  '/verify-email',
  validateBody(verifyEmailValidator),
  asyncHandler(authController.verifyEmail)
);

/**
 * @route   POST /api/v1/auth/resend-verification
 * @desc    Resend email verification
 * @access  Public
 */
router.post(
  '/resend-verification',
  emailVerificationRateLimit,
  validateBody(resendVerificationValidator),
  asyncHandler(authController.resendVerification)
);

// Protected routes
/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post(
  '/logout',
  authenticate,
  asyncHandler(authController.logout)
);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current user
 * @access  Private
 */
router.get(
  '/me',
  authenticate,
  asyncHandler(authController.getCurrentUser)
);

/**
 * @route   POST /api/v1/auth/change-password
 * @desc    Change password
 * @access  Private
 */
router.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordValidator),
  asyncHandler(authController.changePassword)
);

/**
 * @route   POST /api/v1/auth/enable-2fa
 * @desc    Enable two-factor authentication
 * @access  Private
 */
router.post(
  '/enable-2fa',
  authenticate,
  asyncHandler(authController.enableTwoFactor)
);

/**
 * @route   POST /api/v1/auth/disable-2fa
 * @desc    Disable two-factor authentication
 * @access  Private
 */
router.post(
  '/disable-2fa',
  authenticate,
  asyncHandler(authController.disableTwoFactor)
);

/**
 * @route   POST /api/v1/auth/verify-2fa
 * @desc    Verify two-factor authentication code
 * @access  Private
 */
router.post(
  '/verify-2fa',
  authenticate,
  asyncHandler(authController.verifyTwoFactor)
);

/**
 * @route   GET /api/v1/auth/sessions
 * @desc    Get all active sessions
 * @access  Private
 */
router.get(
  '/sessions',
  authenticate,
  asyncHandler(authController.getSessions)
);

/**
 * @route   DELETE /api/v1/auth/sessions/:sessionId
 * @desc    Revoke a session
 * @access  Private
 */
router.delete(
  '/sessions/:sessionId',
  authenticate,
  asyncHandler(authController.revokeSession)
);

/**
 * @route   DELETE /api/v1/auth/sessions
 * @desc    Revoke all sessions except current
 * @access  Private
 */
router.delete(
  '/sessions',
  authenticate,
  asyncHandler(authController.revokeAllSessions)
);

export default router;