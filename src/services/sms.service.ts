import twilio from 'twilio';
import { config } from '@/config/env';
import redisClient from '@/config/redis';

export class SmsService {
  private client: twilio.Twilio;

  constructor() {
    this.client = twilio(config.sms.twilio.accountSid, config.sms.twilio.authToken);
  }

  async sendVerificationCode(phone: string) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await redisClient.set(`sms:${phone}`, code, 600); // 10 minutes
    
    await this.client.messages.create({
      body: `Your verification code is: ${code}`,
      from: config.sms.twilio.phoneNumber,
      to: phone,
    });
  }

  async verifyCode(phone: string, code: string): Promise<boolean> {
    const storedCode = await redisClient.get<string>(`sms:${phone}`);
    if (storedCode === code) {
      await redisClient.delete(`sms:${phone}`);
      return true;
    }
    return false;
  }
}