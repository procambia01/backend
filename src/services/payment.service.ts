// src/services/payment.service.ts
import axios from 'axios';
import { config } from '@/config/env';
import { prisma } from '@/config/database';
import { TransactionStatus } from '@prisma/client';
import logger from '@/utils/logger.util';

const paystack = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${config.paystack?.secretKey ?? ''}` },
});

export class PaymentService {
  async initializeTransaction(data: {
    userId: string;
    email: string;
    amount: number;      // in kobo/cents
    currency?: string;
    reference: string;
    metadata?: Record<string, unknown>;
  }) {
    const res = await paystack.post('/transaction/initialize', {
      email:     data.email,
      amount:    data.amount,
      currency:  data.currency ?? 'NGN',
      reference: data.reference,
      metadata:  data.metadata,
      callback_url: `${config.appUrl}/api/payments/callback`,
    });

    const record = await prisma.transaction.create({
      data: {
        userId:              data.userId,
        type:                'VERIFICATION_FEE',
        amount:              data.amount / 100,
        currency:            data.currency ?? 'NGN',
        description:         'Payment',
        status:              TransactionStatus.PENDING,
        paymentGateway:      'paystack',
        gatewayTransactionId:data.reference,
      },
    });

    return { ...res.data.data, transactionId: record.id };
  }

  async verifyTransaction(reference: string) {
    const res = await paystack.get(`/transaction/verify/${reference}`);
    const tx  = res.data.data;

    const status: TransactionStatus =
      tx.status === 'success' ? TransactionStatus.COMPLETED :
      tx.status === 'failed'  ? TransactionStatus.FAILED :
      TransactionStatus.PENDING;

    await prisma.transaction.updateMany({
      where: { gatewayTransactionId: reference },
      data:  {
        status,
        gatewayResponse: tx,
        completedAt: status === TransactionStatus.COMPLETED ? new Date() : undefined,
      },
    });

    return { success: tx.status === 'success', data: tx };
  }
}
