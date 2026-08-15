import { Request, Response } from 'express';
import { SwapService } from '@/services/swap.service';
import { FeeService } from '@/services/fee.service';
import ResponseUtil from '@/utils/response.util';
import PaginationUtil from '@/utils/pagination.util';
import { NotFoundError, ForbiddenError, BadRequestError } from '@/utils/error.util';
import { prisma } from '@/config/database';

export class SwapController {
  private swapService: SwapService;
  private feeService: FeeService;

  constructor() {
    this.swapService = new SwapService();
    this.feeService = new FeeService();
  }

  /**
   * Get user swaps
   */
  getUserSwaps = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.swapService.getUserSwaps(userId, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Get active swaps
   */
  getActiveSwaps = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const swaps = await this.swapService.getActiveSwaps(userId);
    return ResponseUtil.success(res, swaps);
  };

  /**
   * Get pending swaps
   */
  getPendingSwaps = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const swaps = await this.swapService.getPendingSwaps(userId);
    return ResponseUtil.success(res, swaps);
  };

  /**
   * Get completed swaps
   */
  getCompletedSwaps = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.swapService.getCompletedSwaps(userId, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Get swap statistics
   */
  getSwapStatistics = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const stats = await this.swapService.getSwapStatistics(userId);
    return ResponseUtil.success(res, stats);
  };

  /**
   * Initiate swap
   */
  initiateSwap = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { offerId, message } = req.body;
    const swap = await this.swapService.initiateSwap(userId, offerId, message);
    return ResponseUtil.created(res, swap, 'Swap initiated successfully');
  };

  /**
   * Get swap by ID
   */
  getSwapById = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const swap = await this.swapService.getSwapById(id, userId);
    return ResponseUtil.success(res, swap);
  };

  /**
   * Accept swap
   */
  acceptSwap = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const swap = await this.swapService.acceptSwap(id, userId);
    return ResponseUtil.success(res, swap, 'Swap accepted successfully');
  };

  /**
   * Reject swap
   */
  rejectSwap = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { reason } = req.body;
    const swap = await this.swapService.rejectSwap(id, userId, reason);
    return ResponseUtil.success(res, swap, 'Swap rejected');
  };

  /**
   * Update meetup details
   */
  updateMeetup = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const meetupData = req.body;
    const swap = await this.swapService.updateMeetup(id, userId, meetupData);
    return ResponseUtil.success(res, swap, 'Meetup details updated');
  };

  /**
   * Confirm meetup details
   */
  confirmMeetup = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const swap = await this.swapService.confirmMeetup(id, userId);
    return ResponseUtil.success(res, swap, 'Meetup confirmed');
  };

  /**
   * Confirm money sent
   */
  confirmSent = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const swap = await this.swapService.confirmSent(id, userId);
    return ResponseUtil.success(res, swap, 'Money sent confirmed');
  };

  /**
   * Confirm money received
   */
  confirmReceived = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { rating, comment } = req.body;
    const swap = await this.swapService.confirmReceived(id, userId, rating, comment);
    return ResponseUtil.success(res, swap, 'Money received confirmed');
  };

  /**
   * Complete swap
   */
  completeSwap = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const swap = await this.swapService.completeSwap(id);
    return ResponseUtil.success(res, swap, 'Swap completed successfully');
  };

  /**
   * Cancel swap
   */
  cancelSwap = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { reason } = req.body;
    const swap = await this.swapService.cancelSwap(id, userId, reason);
    return ResponseUtil.success(res, swap, 'Swap cancelled');
  };

  /**
   * Report issue
   */
  reportIssue = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { issue, description, evidence } = req.body;
    await this.swapService.reportIssue(id, userId, issue, description, evidence);
    return ResponseUtil.success(res, null, 'Issue reported successfully');
  };

  /**
   * Get swap timeline
   */
  getSwapTimeline = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const timeline = await this.swapService.getSwapTimeline(id, userId);
    return ResponseUtil.success(res, timeline);
  };

  /**
   * Request extension
   */
  requestExtension = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { hours, reason } = req.body;
    await this.swapService.requestExtension(id, userId, hours, reason);
    return ResponseUtil.success(res, null, 'Extension requested');
  };

  /**
   * Send reminder
   */
  sendReminder = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    await this.swapService.sendReminder(id, userId);
    return ResponseUtil.success(res, null, 'Reminder sent');
  };

  /**
   * Get participants
   */
  getParticipants = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const participants = await this.swapService.getParticipants(id, userId);
    return ResponseUtil.success(res, participants);
  };

  /**
   * Get this user's fee status for a swap
   */
  getFeeStatus = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const swap = await prisma.swap.findUnique({ where: { id } });
    if (!swap) throw new NotFoundError('Swap not found');

    const isInitiator = swap.initiatorId === userId;
    const isReceiver = swap.receiverId === userId;
    if (!isInitiator && !isReceiver) throw new ForbiddenError('You do not have access to this swap');

    const amount = isInitiator ? swap.initiatorFeeAmount : swap.receiverFeeAmount;
    const waived = isInitiator ? swap.initiatorFeeWaived : swap.receiverFeeWaived;
    const paidAt = isInitiator ? swap.initiatorFeePaidAt : swap.receiverFeePaidAt;
    const currency = isInitiator ? swap.initiatorGivesCurrency : swap.receiverGivesCurrency;

    return ResponseUtil.success(res, {
      amount,
      currency,
      waived,
      paid: Boolean(paidAt),
      paidAt,
      needsPayment: !waived && !paidAt && Boolean(amount),
    });
  };

  /**
   * Create a Stripe Checkout session for a user to pay their outstanding
   * swap fee (used when we couldn't charge their saved card off-session,
   * or they never saved one).
   */
  createFeeCheckout = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const swap = await prisma.swap.findUnique({ where: { id } });
    if (!swap) throw new NotFoundError('Swap not found');
    if (swap.status !== 'COMPLETED') throw new BadRequestError('Fees are only due after a swap is completed');

    const isInitiator = swap.initiatorId === userId;
    const isReceiver = swap.receiverId === userId;
    if (!isInitiator && !isReceiver) throw new ForbiddenError('You do not have access to this swap');

    const amount = isInitiator ? swap.initiatorFeeAmount : swap.receiverFeeAmount;
    const waived = isInitiator ? swap.initiatorFeeWaived : swap.receiverFeeWaived;
    const paidAt = isInitiator ? swap.initiatorFeePaidAt : swap.receiverFeePaidAt;
    const currency = isInitiator ? swap.initiatorGivesCurrency : swap.receiverGivesCurrency;

    if (waived || paidAt || !amount) {
      throw new BadRequestError('No fee is due on this swap');
    }

    const origin = (req.headers.origin as string) ?? process.env.APP_URL ?? '';
    const session = await this.feeService.createFeeCheckoutSession(
      userId,
      id,
      isInitiator ? 'initiator' : 'receiver',
      amount,
      currency,
      origin
    );

    return ResponseUtil.success(res, { url: session.url });
  };
}