import { Router } from 'express';
import { OfferController } from '@/controllers/offer.controller';
import { authenticate, requireIdVerified } from '@/middleware/auth.middleware';
import { validateBody, validateParams } from '@/middleware/validate.middleware';
import { createOfferRateLimit } from '@/middleware/rateLimit.middleware';
import {
  createOfferValidator,
  updateOfferValidator,
  searchOffersValidator,
} from '@/validators/offer.validator';
import { asyncHandler } from '@/middleware/error.middleware';

const router = Router();
const offerController = new OfferController();

/**
 * @route   GET /api/v1/offers
 * @desc    Get all offers (with filters)
 * @access  Private
 */
router.get(
  '/',
  authenticate,
  asyncHandler(offerController.getAllOffers)
);

/**
 * @route   POST /api/v1/offers/search
 * @desc    Search offers with advanced filters
 * @access  Private
 */
router.post(
  '/search',
  authenticate,
  validateBody(searchOffersValidator),
  asyncHandler(offerController.searchOffers)
);

/**
 * @route   GET /api/v1/offers/nearby
 * @desc    Get nearby offers based on location
 * @access  Private
 */
router.get(
  '/nearby',
  authenticate,
  asyncHandler(offerController.getNearbyOffers)
);

/**
 * @route   GET /api/v1/offers/featured
 * @desc    Get featured offers
 * @access  Private
 */
router.get(
  '/featured',
  authenticate,
  asyncHandler(offerController.getFeaturedOffers)
);

/**
 * @route   GET /api/v1/offers/trending
 * @desc    Get trending offers
 * @access  Private
 */
router.get(
  '/trending',
  authenticate,
  asyncHandler(offerController.getTrendingOffers)
);

/**
 * @route   GET /api/v1/offers/matches
 * @desc    Get matching offers for user
 * @access  Private
 */
router.get(
  '/matches',
  authenticate,
  asyncHandler(offerController.getMatchingOffers)
);

/**
 * @route   POST /api/v1/offers
 * @desc    Create a new offer
 * @access  Private (Verified users only)
 */
router.post(
  '/',
  authenticate,
  requireIdVerified,
  createOfferRateLimit,
  validateBody(createOfferValidator),
  asyncHandler(offerController.createOffer)
);

/**
 * @route   GET /api/v1/offers/:id
 * @desc    Get offer by ID
 * @access  Private
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(offerController.getOfferById)
);

/**
 * @route   PUT /api/v1/offers/:id
 * @desc    Update offer
 * @access  Private (Owner only)
 */
router.put(
  '/:id',
  authenticate,
  validateBody(updateOfferValidator),
  asyncHandler(offerController.updateOffer)
);

/**
 * @route   DELETE /api/v1/offers/:id
 * @desc    Delete offer
 * @access  Private (Owner only)
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(offerController.deleteOffer)
);

/**
 * @route   PATCH /api/v1/offers/:id/pause
 * @desc    Pause offer
 * @access  Private (Owner only)
 */
router.patch(
  '/:id/pause',
  authenticate,
  asyncHandler(offerController.pauseOffer)
);

/**
 * @route   PATCH /api/v1/offers/:id/resume
 * @desc    Resume offer
 * @access  Private (Owner only)
 */
router.patch(
  '/:id/resume',
  authenticate,
  asyncHandler(offerController.resumeOffer)
);

/**
 * @route   POST /api/v1/offers/:id/boost
 * @desc    Boost offer (premium feature)
 * @access  Private (Owner only)
 */
router.post(
  '/:id/boost',
  authenticate,
  asyncHandler(offerController.boostOffer)
);

/**
 * @route   POST /api/v1/offers/:id/feature
 * @desc    Feature offer (premium feature)
 * @access  Private (Owner only)
 */
router.post(
  '/:id/feature',
  authenticate,
  asyncHandler(offerController.featureOffer)
);

/**
 * @route   GET /api/v1/offers/:id/matches
 * @desc    Get matches for specific offer
 * @access  Private (Owner only)
 */
router.get(
  '/:id/matches',
  authenticate,
  asyncHandler(offerController.getOfferMatches)
);

/**
 * @route   POST /api/v1/offers/:id/view
 * @desc    Increment offer view count
 * @access  Private
 */
router.post(
  '/:id/view',
  authenticate,
  asyncHandler(offerController.incrementViewCount)
);

/**
 * @route   GET /api/v1/offers/:id/analytics
 * @desc    Get offer analytics
 * @access  Private (Owner only)
 */
router.get(
  '/:id/analytics',
  authenticate,
  asyncHandler(offerController.getOfferAnalytics)
);

/**
 * @route   POST /api/v1/offers/:id/report
 * @desc    Report an offer
 * @access  Private
 */
router.post(
  '/:id/report',
  authenticate,
  asyncHandler(offerController.reportOffer)
);

export default router;