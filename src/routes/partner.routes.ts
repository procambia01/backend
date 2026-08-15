import { Router } from 'express';
import { PartnerController } from '@/controllers/partner.controller';
import { apiKeyAuth, requireScope } from '@/middleware/apiKeyAuth.middleware';
import { asyncHandler } from '@/middleware/error.middleware';

const router = Router();
const partnerController = new PartnerController();

// Every route here is authenticated via the X-API-Key header, not a JWT —
// this is the surface partners (forex bureaus, remittance agents) call
// from their own backend, not something an end user's app hits directly.
router.use(apiKeyAuth);

/**
 * @route   GET /api/v1/partner/rates
 * @desc    Reference exchange rate between two currencies
 * @access  Partner (API key, scope rates:read)
 */
router.get('/rates', requireScope('rates:read'), asyncHandler(partnerController.getRate));

/**
 * @route   GET /api/v1/partner/market-rates
 * @desc    Real peer-agreed rates from completed swaps in a corridor
 * @access  Partner (API key, scope rates:read)
 */
router.get(
  '/market-rates',
  requireScope('rates:read'),
  asyncHandler(partnerController.getMarketRates)
);

/**
 * @route   GET /api/v1/partner/offer-density
 * @desc    Anonymized active-offer counts by currency pair / location
 * @access  Partner (API key, scope offers:read)
 */
router.get(
  '/offer-density',
  requireScope('offers:read'),
  asyncHandler(partnerController.getOfferDensity)
);

/**
 * @route   GET /api/v1/partner/usage
 * @desc    This API key's own usage stats
 * @access  Partner (API key)
 */
router.get('/usage', asyncHandler(partnerController.getUsage));

export default router;
