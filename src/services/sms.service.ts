import twilio from 'twilio';
import { config } from '@/config/env';
import logger from '@/utils/logger.util';
import { ServiceUnavailableError } from '@/utils/error.util';

/** Pure transport — OTP generation / hashing / expiry live in PhoneVerificationService. */
export class SmsService {
  private client?: twilio.Twilio;

  async send(to: string, body: string): Promise<void> {
    if (config.sms.driver === 'console') {
      // Only reachable outside production (enforced by the env schema).
      logger.info('sms (console driver)', { to: to.slice(0, 4) + '***' });
      return;
    }
    const { accountSid, authToken, phoneNumber } = config.sms.twilio;
    if (!accountSid || !authToken || !phoneNumber) throw new ServiceUnavailableError('SMS delivery is not configured');
    this.client ??= twilio(accountSid, authToken);
    await this.client.messages.create({ body, from: phoneNumber, to });
  }
}

export const smsService = new SmsService();
