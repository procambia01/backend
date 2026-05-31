import { Request, Response } from 'express';
import { OfferService } from '@/services/offer.service';
import ResponseUtil from '@/utils/response.util';
import PaginationUtil from '@/utils/pagination.util';

export class OfferController {
  private offerService: OfferService;

  constructor() {
    this.offerService = new OfferService();
  }

  /**
   * Get all offers
   */
  getAllOffers = async (req: Request, res: Response): Promise<Response> => {
    const pagination = PaginationUtil.parseParams(req.query);
    const filters = req.query;
    const result = await this.offerService.getAllOffers(filters, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Get current user's own offers
   * Handles GET /api/v1/offers/my — must be routed BEFORE /:id
   */
  getMyOffers = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const pagination = PaginationUtil.parseParams(req.query);
    const filters = { ...req.query, userId };
    const result = await this.offerService.getUserOffers(userId, filters, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Search offers
   */
  searchOffers = async (req: Request, res: Response): Promise<Response> => {
    const searchParams = req.body;
    const result = await this.offerService.searchOffers(searchParams);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Get nearby offers
   */
  getNearbyOffers = async (req: Request, res: Response): Promise<Response> => {
    const { latitude, longitude, radius, haveCurrency, wantCurrency } = req.query;
    const offers = await this.offerService.getNearbyOffers(
      Number(latitude),
      Number(longitude),
      Number(radius) || 10,
      haveCurrency as string,
      wantCurrency as string
    );
    return ResponseUtil.success(res, offers);
  };

  /**
   * Get featured offers
   */
  getFeaturedOffers = async (req: Request, res: Response): Promise<Response> => {
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.offerService.getFeaturedOffers(pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Get trending offers
   */
  getTrendingOffers = async (req: Request, res: Response): Promise<Response> => {
    const limit = Number(req.query.limit) || 10;
    const offers = await this.offerService.getTrendingOffers(limit);
    return ResponseUtil.success(res, offers);
  };

  /**
   * Get matching offers for user
   */
  getMatchingOffers = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.offerService.getMatchingOffers(userId, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Create offer
   */
  createOffer = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const offerData = req.body;
    const offer = await this.offerService.createOffer(userId, offerData);
    return ResponseUtil.created(res, offer, 'Offer created successfully');
  };

  /**
   * Get offer by ID
   */
  getOfferById = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const offer = await this.offerService.getOfferById(id);
    return ResponseUtil.success(res, offer);
  };

  /**
   * Update offer
   */
  updateOffer = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const updateData = req.body;
    const offer = await this.offerService.updateOffer(id, userId, updateData);
    return ResponseUtil.success(res, offer, 'Offer updated successfully');
  };

  /**
   * Delete offer
   */
  deleteOffer = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    await this.offerService.deleteOffer(id, userId);
    return ResponseUtil.success(res, null, 'Offer deleted successfully');
  };

  /**
   * Pause offer
   */
  pauseOffer = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const offer = await this.offerService.pauseOffer(id, userId);
    return ResponseUtil.success(res, offer, 'Offer paused successfully');
  };

  /**
   * Resume offer
   */
  resumeOffer = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const offer = await this.offerService.resumeOffer(id, userId);
    return ResponseUtil.success(res, offer, 'Offer resumed successfully');
  };

  /**
   * Boost offer (premium feature)
   */
  boostOffer = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { duration } = req.body;
    const offer = await this.offerService.boostOffer(id, userId, duration);
    return ResponseUtil.success(res, offer, 'Offer boosted successfully');
  };

  /**
   * Feature offer (premium feature)
   */
  featureOffer = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { duration } = req.body;
    const offer = await this.offerService.featureOffer(id, userId, duration);
    return ResponseUtil.success(res, offer, 'Offer featured successfully');
  };

  /**
   * Get matches for specific offer
   */
  getOfferMatches = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const matches = await this.offerService.getOfferMatches(id, userId);
    return ResponseUtil.success(res, matches);
  };

  /**
   * Increment view count
   */
  incrementViewCount = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    await this.offerService.incrementViewCount(id);
    return ResponseUtil.success(res, null, 'View count incremented');
  };

  /**
   * Get offer analytics
   */
  getOfferAnalytics = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const analytics = await this.offerService.getOfferAnalytics(id, userId);
    return ResponseUtil.success(res, analytics);
  };

  /**
   * Report offer
   */
  reportOffer = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { reason, description } = req.body;
    await this.offerService.reportOffer(id, userId, reason, description);
    return ResponseUtil.success(res, null, 'Offer reported successfully');
  };
}
