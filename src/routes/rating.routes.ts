import { Router } from 'express';
import { RatingController } from '@/controllers/rating.controller';
import { authenticate } from '@/middleware/auth.middleware';
import { validateBody } from '@/middleware/validate.middleware';
import { createRatingValidator, reportRatingValidator } from '@/validators/rating.validator';
import { asyncHandler } from '@/middleware/error.middleware';

const router = Router();
const ratingController = new RatingController();

/**
 * @route   POST /api/v1/ratings
 * @desc    Create a rating
 * @access  Private (After completed swap)
 */
router.post(
  '/',
  authenticate,
  validateBody(createRatingValidator),
  asyncHandler(ratingController.createRating)
);

/**
 * @route   GET /api/v1/ratings/user/:userId
 * @desc    Get ratings for a user
 * @access  Private
 */
router.get(
  '/user/:userId',
  authenticate,
  asyncHandler(ratingController.getUserRatings)
);

/**
 * @route   GET /api/v1/ratings/swap/:swapId
 * @desc    Get ratings for a swap
 * @access  Private (Parties involved only)
 */
router.get(
  '/swap/:swapId',
  authenticate,
  asyncHandler(ratingController.getSwapRatings)
);

/**
 * @route   GET /api/v1/ratings/:id
 * @desc    Get rating by ID
 * @access  Private
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(ratingController.getRatingById)
);

/**
 * @route   PUT /api/v1/ratings/:id
 * @desc    Update rating
 * @access  Private (Creator only - within time limit)
 */
router.put(
  '/:id',
  authenticate,
  validateBody(createRatingValidator),
  asyncHandler(ratingController.updateRating)
);

/**
 * @route   DELETE /api/v1/ratings/:id
 * @desc    Delete rating
 * @access  Private (Creator only - within time limit)
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(ratingController.deleteRating)
);

/**
 * @route   POST /api/v1/ratings/:id/report
 * @desc    Report a rating
 * @access  Private
 */
router.post(
  '/:id/report',
  authenticate,
  validateBody(reportRatingValidator),
  asyncHandler(ratingController.reportRating)
);

/**
 * @route   POST /api/v1/ratings/:id/helpful
 * @desc    Mark rating as helpful
 * @access  Private
 */
router.post(
  '/:id/helpful',
  authenticate,
  asyncHandler(ratingController.markAsHelpful)
);

/**
 * @route   GET /api/v1/ratings/pending
 * @desc    Get pending ratings (swaps that need rating)
 * @access  Private
 */
router.get(
  '/pending',
  authenticate,
  asyncHandler(ratingController.getPendingRatings)
);

export default router;