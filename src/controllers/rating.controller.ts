// src/controllers/rating.controllers.ts
import { Request, Response } from 'express';
import { RatingService } from '@/services/rating.service';
import ResponseUtil from '@/utils/response.util';
import PaginationUtil from '@/utils/pagination.util';

export class RatingController {
  private ratingService: RatingService;

  constructor() {
    this.ratingService = new RatingService();
  }

  createRating = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const ratingData = req.body;
    const rating = await this.ratingService.createRating(userId, ratingData);
    return ResponseUtil.created(res, rating, 'Rating created successfully');
  };

  getUserRatings = async (req: Request, res: Response): Promise<Response> => {
    const { userId } = req.params;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.ratingService.getUserRatings(userId, pagination);
    return ResponseUtil.paginated(res, result.data, result.meta.page, result.meta.perPage, result.meta.total);
  };

  getSwapRatings = async (req: Request, res: Response): Promise<Response> => {
    const { swapId } = req.params;
    const userId = req.user!.userId;
    const ratings = await this.ratingService.getSwapRatings(swapId, userId);
    return ResponseUtil.success(res, ratings);
  };

  getRatingById = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const rating = await this.ratingService.getRatingById(id);
    return ResponseUtil.success(res, rating);
  };

  updateRating = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const updateData = req.body;
    const rating = await this.ratingService.updateRating(id, userId, updateData);
    return ResponseUtil.success(res, rating, 'Rating updated');
  };

  deleteRating = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    await this.ratingService.deleteRating(id, userId);
    return ResponseUtil.success(res, null, 'Rating deleted');
  };

  reportRating = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { reason } = req.body;
    await this.ratingService.reportRating(id, userId, reason);
    return ResponseUtil.success(res, null, 'Rating reported');
  };

  markAsHelpful = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    await this.ratingService.markAsHelpful(id, userId);
    return ResponseUtil.success(res, null, 'Marked as helpful');
  };

  getPendingRatings = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const swaps = await this.ratingService.getPendingRatings(userId);
    return ResponseUtil.success(res, swaps);
  };
}
