import { Router as TransactionRouter } from 'express';
import { TransactionController } from '@/controllers/transaction.controller';
import { authenticate } from '@/middleware/auth.middleware';
import { requireSelfOrAdmin } from '@/middleware/role.middleware';
import { asyncHandler } from '@/middleware/error.middleware';

const transactionRouter = TransactionRouter();
const transactionController = new TransactionController();

transactionRouter.get('/', authenticate, asyncHandler(transactionController.getUserTransactions));
transactionRouter.get('/summary', authenticate, asyncHandler(transactionController.getTransactionSummary));
transactionRouter.get('/:id', authenticate, asyncHandler(transactionController.getTransactionById));
transactionRouter.post('/verify-payment', authenticate, asyncHandler(transactionController.verifyPayment));

export { transactionRouter as default };
