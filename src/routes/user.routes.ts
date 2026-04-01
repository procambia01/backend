import { Router } from 'express';
import { UserController } from '@/controllers/user.controller';
import { authenticate, requireIdVerified } from '@/middleware/auth.middleware';
import { requireSelfOrAdmin } from '@/middleware/role.middleware';
import { validateBody, validateParams, validateQuery } from '@/middleware/validate.middleware';
import { uploadProfileImage, uploadIdDocument, uploadSelfie } from '@/middleware/upload.middleware';
import { uploadRateLimit } from '@/middleware/rateLimit.middleware';
import {
  updateProfileValidator,
  updatePreferencesValidator,
  verifyPhoneValidator,
  submitVerificationValidator,
  blockUserValidator,
  addFavoriteValidator,
} from '@/validators/user.validator';
import { asyncHandler } from '@/middleware/error.middleware';

const router = Router();
const userController = new UserController();

/**
 * @route   GET /api/v1/users
 * @desc    Get all users (with filters)
 * @access  Private (Admin)
 */
router.get(
  '/',
  authenticate,
  asyncHandler(userController.getAllUsers)
);

/**
 * @route   GET /api/v1/users/search
 * @desc    Search users
 * @access  Private
 */
router.get(
  '/search',
  authenticate,
  asyncHandler(userController.searchUsers)
);

/**
 * @route   GET /api/v1/users/nearby
 * @desc    Get nearby users
 * @access  Private
 */
router.get(
  '/nearby',
  authenticate,
  asyncHandler(userController.getNearbyUsers)
);

/**
 * @route   GET /api/v1/users/:id
 * @desc    Get user by ID
 * @access  Private
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(userController.getUserById)
);

/**
 * @route   PUT /api/v1/users/:id
 * @desc    Update user profile
 * @access  Private (Self or Admin)
 */
router.put(
  '/:id',
  authenticate,
  requireSelfOrAdmin('id'),
  validateBody(updateProfileValidator),
  asyncHandler(userController.updateProfile)
);

/**
 * @route   DELETE /api/v1/users/:id
 * @desc    Delete user account
 * @access  Private (Self or Admin)
 */
router.delete(
  '/:id',
  authenticate,
  requireSelfOrAdmin('id'),
  asyncHandler(userController.deleteAccount)
);

/**
 * @route   POST /api/v1/users/:id/profile-image
 * @desc    Upload profile image
 * @access  Private (Self or Admin)
 */
router.post(
  '/:id/profile-image',
  authenticate,
  requireSelfOrAdmin('id'),
  uploadRateLimit,
  uploadProfileImage(),
  asyncHandler(userController.uploadProfileImage)
);

/**
 * @route   DELETE /api/v1/users/:id/profile-image
 * @desc    Delete profile image
 * @access  Private (Self or Admin)
 */
router.delete(
  '/:id/profile-image',
  authenticate,
  requireSelfOrAdmin('id'),
  asyncHandler(userController.deleteProfileImage)
);

/**
 * @route   GET /api/v1/users/:id/stats
 * @desc    Get user statistics
 * @access  Private
 */
router.get(
  '/:id/stats',
  authenticate,
  asyncHandler(userController.getUserStats)
);

/**
 * @route   GET /api/v1/users/:id/ratings
 * @desc    Get user ratings
 * @access  Private
 */
router.get(
  '/:id/ratings',
  authenticate,
  asyncHandler(userController.getUserRatings)
);

/**
 * @route   GET /api/v1/users/:id/swaps
 * @desc    Get user swap history
 * @access  Private (Self or Admin)
 */
router.get(
  '/:id/swaps',
  authenticate,
  requireSelfOrAdmin('id'),
  asyncHandler(userController.getUserSwaps)
);

/**
 * @route   GET /api/v1/users/:id/offers
 * @desc    Get user offers
 * @access  Private
 */
router.get(
  '/:id/offers',
  authenticate,
  asyncHandler(userController.getUserOffers)
);

/**
 * @route   PUT /api/v1/users/:id/preferences
 * @desc    Update user preferences
 * @access  Private (Self)
 */
router.put(
  '/:id/preferences',
  authenticate,
  requireSelfOrAdmin('id'),
  validateBody(updatePreferencesValidator),
  asyncHandler(userController.updatePreferences)
);

/**
 * @route   PUT /api/v1/users/:id/location
 * @desc    Update user location
 * @access  Private (Self)
 */
router.put(
  '/:id/location',
  authenticate,
  requireSelfOrAdmin('id'),
  asyncHandler(userController.updateLocation)
);

// Verification routes
/**
 * @route   POST /api/v1/users/:id/verify-phone
 * @desc    Verify phone number
 * @access  Private (Self)
 */
router.post(
  '/:id/verify-phone',
  authenticate,
  requireSelfOrAdmin('id'),
  validateBody(verifyPhoneValidator),
  asyncHandler(userController.verifyPhone)
);

/**
 * @route   POST /api/v1/users/:id/verification/submit
 * @desc    Submit ID verification
 * @access  Private (Self)
 */
router.post(
  '/:id/verification/submit',
  authenticate,
  requireSelfOrAdmin('id'),
  uploadRateLimit,
  uploadIdDocument(),
  validateBody(submitVerificationValidator),
  asyncHandler(userController.submitVerification)
);

/**
 * @route   POST /api/v1/users/:id/verification/selfie
 * @desc    Upload verification selfie
 * @access  Private (Self)
 */
router.post(
  '/:id/verification/selfie',
  authenticate,
  requireSelfOrAdmin('id'),
  uploadRateLimit,
  uploadSelfie(),
  asyncHandler(userController.uploadVerificationSelfie)
);

/**
 * @route   GET /api/v1/users/:id/verification/status
 * @desc    Get verification status
 * @access  Private (Self or Admin)
 */
router.get(
  '/:id/verification/status',
  authenticate,
  requireSelfOrAdmin('id'),
  asyncHandler(userController.getVerificationStatus)
);

// Block/Unblock users
/**
 * @route   POST /api/v1/users/:id/block
 * @desc    Block a user
 * @access  Private
 */
router.post(
  '/:id/block',
  authenticate,
  validateBody(blockUserValidator),
  asyncHandler(userController.blockUser)
);

/**
 * @route   DELETE /api/v1/users/:id/block
 * @desc    Unblock a user
 * @access  Private
 */
router.delete(
  '/:id/block',
  authenticate,
  asyncHandler(userController.unblockUser)
);

/**
 * @route   GET /api/v1/users/:id/blocked
 * @desc    Get blocked users
 * @access  Private (Self)
 */
router.get(
  '/:id/blocked',
  authenticate,
  requireSelfOrAdmin('id'),
  asyncHandler(userController.getBlockedUsers)
);

// Favorites
/**
 * @route   POST /api/v1/users/:id/favorites
 * @desc    Add user to favorites
 * @access  Private
 */
router.post(
  '/:id/favorites',
  authenticate,
  validateBody(addFavoriteValidator),
  asyncHandler(userController.addFavorite)
);

/**
 * @route   DELETE /api/v1/users/:id/favorites/:favoriteId
 * @desc    Remove user from favorites
 * @access  Private
 */
router.delete(
  '/:id/favorites/:favoriteId',
  authenticate,
  asyncHandler(userController.removeFavorite)
);

/**
 * @route   GET /api/v1/users/:id/favorites
 * @desc    Get favorite users
 * @access  Private (Self)
 */
router.get(
  '/:id/favorites',
  authenticate,
  requireSelfOrAdmin('id'),
  asyncHandler(userController.getFavorites)
);

// Premium
/**
 * @route   POST /api/v1/users/:id/premium/subscribe
 * @desc    Subscribe to premium
 * @access  Private (Self)
 */
router.post(
  '/:id/premium/subscribe',
  authenticate,
  requireSelfOrAdmin('id'),
  asyncHandler(userController.subscribePremium)
);

/**
 * @route   POST /api/v1/users/:id/premium/cancel
 * @desc    Cancel premium subscription
 * @access  Private (Self)
 */
router.post(
  '/:id/premium/cancel',
  authenticate,
  requireSelfOrAdmin('id'),
  asyncHandler(userController.cancelPremium)
);

/**
 * @route   GET /api/v1/users/:id/premium/status
 * @desc    Get premium status
 * @access  Private (Self or Admin)
 */
router.get(
  '/:id/premium/status',
  authenticate,
  requireSelfOrAdmin('id'),
  asyncHandler(userController.getPremiumStatus)
);

// Activity
/**
 * @route   GET /api/v1/users/:id/activity
 * @desc    Get user activity log
 * @access  Private (Self or Admin)
 */
router.get(
  '/:id/activity',
  authenticate,
  requireSelfOrAdmin('id'),
  asyncHandler(userController.getActivityLog)
);

export default router;