// src/controllers/transaction.controller.ts
import { Request, Response } from 'express';
import { TransactionService } from '@/services/transaction.service';
import ResponseUtil from '@/utils/response.util';
import PaginationUtil from '@/utils/pagination.util';

export class TransactionController {
  private transactionService: TransactionService;

  constructor() {
    this.transactionService = new TransactionService();
  }

  getUserTransactions = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.transactionService.getUserTransactions(userId, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  getTransactionSummary = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const summary = await this.transactionService.getTransactionSummary(userId);
    return ResponseUtil.success(res, summary);
  };

  getTransactionById = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const transaction = await this.transactionService.getTransactionById(id, userId);
    return ResponseUtil.success(res, transaction);
  };

  verifyPayment = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { transactionId, gateway } = req.body;
    const result = await this.transactionService.verifyPayment(
      transactionId,
      gateway,
      userId
    );
    return ResponseUtil.success(res, result, 'Payment verified');
  };

  getPendingTransactions = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const transactions = await this.transactionService.getPendingTransactions(userId);
    return ResponseUtil.success(res, transactions);
  };

  cancelTransaction = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const transaction = await this.transactionService.cancelTransaction(id, userId);
    return ResponseUtil.success(res, transaction, 'Transaction cancelled');
  };

  refundTransaction = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { reason } = req.body;
    const transaction = await this.transactionService.refundTransaction(
      id,
      userId,
      reason
    );
    return ResponseUtil.success(res, transaction, 'Transaction refunded');
  };

  getTransactionStats = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { period } = req.query;
    const stats = await this.transactionService.getTransactionStats(
      userId,
      period as 'week' | 'month' | 'year'
    );
    return ResponseUtil.success(res, stats);
  };
}