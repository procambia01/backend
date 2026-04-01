// src/controllers/dispute.controller.ts
import { Request, Response } from 'express';
import { DisputeService } from '@/services/dispute.service';
import ResponseUtil from '@/utils/response.util';
import PaginationUtil from '@/utils/pagination.util';

export class DisputeController {
  private disputeService: DisputeService;

  constructor() {
    this.disputeService = new DisputeService();
  }

  getUserDisputes = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.disputeService.getUserDisputes(userId, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  createDispute = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const disputeData = req.body;
    const dispute = await this.disputeService.createDispute(userId, disputeData);
    return ResponseUtil.created(res, dispute, 'Dispute created');
  };

  getDisputeById = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const dispute = await this.disputeService.getDisputeById(id, userId);
    return ResponseUtil.success(res, dispute);
  };

  updateDispute = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { evidence, description } = req.body;
    const dispute = await this.disputeService.updateDispute(id, userId, evidence, description);
    return ResponseUtil.success(res, dispute, 'Dispute updated');
  };

  resolveDispute = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const staffId = req.user!.userId;
    const { resolution, resolutionNote } = req.body;
    const dispute = await this.disputeService.resolveDispute(
      id,
      staffId,
      resolution,
      resolutionNote
    );
    return ResponseUtil.success(res, dispute, 'Dispute resolved');
  };

  escalateDispute = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const staffId = req.user!.userId;
    const dispute = await this.disputeService.escalateDispute(id, staffId);
    return ResponseUtil.success(res, dispute, 'Dispute escalated');
  };

  closeDispute = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const staffId = req.user!.userId;
    const dispute = await this.disputeService.closeDispute(id, staffId);
    return ResponseUtil.success(res, dispute, 'Dispute closed');
  };
}