// src/controllers/referral.controller.ts
import { Request, Response } from 'express';
import { ReferralService } from '@/services/referral.service';
import ResponseUtil from '@/utils/response.util';

export class ReferralController {
  private referralService: ReferralService;

  constructor() {
    this.referralService = new ReferralService();
  }

  getMyReferralCode = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const code = await this.referralService.getMyReferralCode(userId);
    return ResponseUtil.success(res, { code });
  };

  getReferralStats = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const stats = await this.referralService.getReferralStats(userId);
    return ResponseUtil.success(res, stats);
  };

  getReferredUsers = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const users = await this.referralService.getReferredUsers(userId);
    return ResponseUtil.success(res, users);
  };

  validateReferralCode = async (req: Request, res: Response): Promise<Response> => {
    const { code } = req.params;
    const isValid = await this.referralService.validateReferralCode(code);
    return ResponseUtil.success(res, { valid: isValid });
  };
}