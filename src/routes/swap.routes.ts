import { Router } from 'express';
import { SwapController } from '@/controllers/swap.controller';
import { authenticate, requireIdVerified } from '@/middleware/auth.middleware';
import { validateBody, validateParams } from '@/middleware/validate.middleware';
import { initiateSwapRateLimit } from '@/middleware/rateLimit.middleware';
import {
  initiateSwapValidator,
  updateMeetupValidator,
  confirmSwapValidator,
  cancelSwapValidator,
} from '@/validators/swap.validator';
import { asyncHandler } from '@/middleware/error.middleware';

const router = Router();
const swapController = new SwapController();

/**
 * @route   GET /api/v1/swaps
 * @desc    Get all swaps (user's swaps)
 * @access  Private
 */
router.get(
  '/',
  authenticate,
  asyncHandler(swapController.getUserSwaps)
);

/**
 * @route   GET /api/v1/swaps/active
 * @desc    Get active swaps
 * @access  Private
 */
router.get(
  '/active',
  authenticate,
  asyncHandler(swapController.getActiveSwaps)
);

/**
 * @route   GET /api/v1/swaps/pending
 * @desc    Get pending swaps (awaiting response)
 * @access  Private
 */
router.get(
  '/pending',
  authenticate,
  asyncHandler(swapController.getPendingSwaps)
);

/**
 * @route   GET /api/v1/swaps/completed
 * @desc    Get completed swaps
 * @access  Private
 */
router.get(
  '/completed',
  authenticate,
  asyncHandler(swapController.getCompletedSwaps)
);

/**
 * @route   GET /api/v1/swaps/statistics
 * @desc    Get swap statistics
 * @access  Private
 */
router.get(
  '/statistics',
  authenticate,
  asyncHandler(swapController.getSwapStatistics)
);

/**
 * @route   POST /api/v1/swaps
 * @desc    Initiate a new swap
 * @access  Private (Verified users only)
 */
router.post(
  '/',
  authenticate,
  requireIdVerified,
  initiateSwapRateLimit,
  validateBody(initiateSwapValidator),
  asyncHandler(swapController.initiateSwap)
);

/**
 * @route   GET /api/v1/swaps/:id
 * @desc    Get swap by ID
 * @access  Private (Parties involved only)
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(swapController.getSwapById)
);

/**
 * @route   POST /api/v1/swaps/:id/accept
 * @desc    Accept swap request
 * @access  Private (Receiver only)
 */
router.post(
  '/:id/accept',
  authenticate,
  asyncHandler(swapController.acceptSwap)
);

/**
 * @route   POST /api/v1/swaps/:id/reject
 * @desc    Reject swap request
 * @access  Private (Receiver only)
 */
router.post(
  '/:id/reject',
  authenticate,
  asyncHandler(swapController.rejectSwap)
);

/**
 * @route   PUT /api/v1/swaps/:id/meetup
 * @desc    Update meetup details
 * @access  Private (Parties involved only)
 */
router.put(
  '/:id/meetup',
  authenticate,
  validateBody(updateMeetupValidator),
  asyncHandler(swapController.updateMeetup)
);

/**
 * @route   POST /api/v1/swaps/:id/confirm-meetup
 * @desc    Confirm meetup details
 * @access  Private (Parties involved only)
 */
router.post(
  '/:id/confirm-meetup',
  authenticate,
  asyncHandler(swapController.confirmMeetup)
);

/**
 * @route   POST /api/v1/swaps/:id/confirm-sent
 * @desc    Confirm money sent
 * @access  Private (Parties involved only)
 */
router.post(
  '/:id/confirm-sent',
  authenticate,
  asyncHandler(swapController.confirmSent)
);

/**
 * @route   POST /api/v1/swaps/:id/confirm-received
 * @desc    Confirm money received
 * @access  Private (Parties involved only)
 */
router.post(
  '/:id/confirm-received',
  authenticate,
  validateBody(confirmSwapValidator),
  asyncHandler(swapController.confirmReceived)
);

/**
 * @route   POST /api/v1/swaps/:id/complete
 * @desc    Mark swap as complete
 * @access  Private (System - when both confirm)
 */
router.post(
  '/:id/complete',
  authenticate,
  asyncHandler(swapController.completeSwap)
);

/**
 * @route   POST /api/v1/swaps/:id/cancel
 * @desc    Cancel swap
 * @access  Private (Parties involved only)
 */
router.post(
  '/:id/cancel',
  authenticate,
  validateBody(cancelSwapValidator),
  asyncHandler(swapController.cancelSwap)
);

/**
 * @route   POST /api/v1/swaps/:id/report-issue
 * @desc    Report an issue with swap
 * @access  Private (Parties involved only)
 */
router.post(
  '/:id/report-issue',
  authenticate,
  asyncHandler(swapController.reportIssue)
);

/**
 * @route   GET /api/v1/swaps/:id/timeline
 * @desc    Get swap timeline/history
 * @access  Private (Parties involved only)
 */
router.get(
  '/:id/timeline',
  authenticate,
  asyncHandler(swapController.getSwapTimeline)
);

/**
 * @route   POST /api/v1/swaps/:id/extend
 * @desc    Request time extension
 * @access  Private (Parties involved only)
 */
router.post(
  '/:id/extend',
  authenticate,
  asyncHandler(swapController.requestExtension)
);

/**
 * @route   POST /api/v1/swaps/:id/reminder
 * @desc    Send reminder to other party
 * @access  Private (Parties involved only)
 */
router.post(
  '/:id/reminder',
  authenticate,
  asyncHandler(swapController.sendReminder)
);

/**
 * @route   GET /api/v1/swaps/:id/participants
 * @desc    Get swap participants info
 * @access  Private (Parties involved only)
 */
router.get(
  '/:id/participants',
  authenticate,
  asyncHandler(swapController.getParticipants)
);

export default router;