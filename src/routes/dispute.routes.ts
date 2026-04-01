import { Router } from 'express';
import { DisputeController } from '@/controllers/dispute.controller';
import { authenticate } from '@/middleware/auth.middleware';
import { requireStaff } from '@/middleware/role.middleware';
import { validateBody } from '@/middleware/validate.middleware';
import { createDisputeValidator, resolveDisputeValidator } from '@/validators/dispute.validator';
import { asyncHandler } from '@/middleware/error.middleware';

const router = Router();
const disputeController = new DisputeController();

/**
 * @route   GET /api/v1/disputes
 * @desc    Get user's disputes
 * @access  Private
 */
router.get(
  '/',
  authenticate,
  asyncHandler(disputeController.getUserDisputes)
);

/**
 * @route   POST /api/v1/disputes
 * @desc    Create a dispute
 * @access  Private
 */
router.post(
  '/',
  authenticate,
  validateBody(createDisputeValidator),
  asyncHandler(disputeController.createDispute)
);

/**
 * @route   GET /api/v1/disputes/:id
 * @desc    Get dispute by ID
 * @access  Private (Involved parties & staff)
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(disputeController.getDisputeById)
);

/**
 * @route   PUT /api/v1/disputes/:id
 * @desc    Update dispute (add evidence)
 * @access  Private (Reporter only)
 */
router.put(
  '/:id',
  authenticate,
  asyncHandler(disputeController.updateDispute)
);

/**
 * @route   POST /api/v1/disputes/:id/resolve
 * @desc    Resolve dispute
 * @access  Private (Staff only)
 */
router.post(
  '/:id/resolve',
  authenticate,
  requireStaff,
  validateBody(resolveDisputeValidator),
  asyncHandler(disputeController.resolveDispute)
);

/**
 * @route   POST /api/v1/disputes/:id/escalate
 * @desc    Escalate dispute
 * @access  Private (Staff only)
 */
router.post(
  '/:id/escalate',
  authenticate,
  requireStaff,
  asyncHandler(disputeController.escalateDispute)
);

/**
 * @route   POST /api/v1/disputes/:id/close
 * @desc    Close dispute
 * @access  Private (Staff only)
 */
router.post(
  '/:id/close',
  authenticate,
  requireStaff,
  asyncHandler(disputeController.closeDispute)
);

export default router;