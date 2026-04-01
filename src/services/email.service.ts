import nodemailer from 'nodemailer';
import { config } from '@/config/env';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth: {
        user: config.email.smtp.user,
        pass: config.email.smtp.password,
      },
    });
  }

  async sendVerificationEmail(to: string, name: string, token: string) {
    const verificationUrl = `${config.appUrl}/verify-email?token=${token}`;
    await this.transporter.sendMail({
      from: `${config.email.fromName} <${config.email.from}>`,
      to,
      subject: 'Verify your email',
      html: `<p>Hi ${name},</p><p>Click <a href="${verificationUrl}">here</a> to verify your email.</p>`,
    });
  }

  async sendPasswordResetEmail(to: string, name: string, token: string) {
    const resetUrl = `${config.appUrl}/reset-password?token=${token}`;
    await this.transporter.sendMail({
      from: `${config.email.fromName} <${config.email.from}>`,
      to,
      subject: 'Reset your password',
      html: `<p>Hi ${name},</p><p>Click <a href="${resetUrl}">here</a> to reset your password.</p>`,
    });
  }

  async sendSwapNotification(to: string, name: string, swapDetails: any) {
    await this.transporter.sendMail({
      from: `${config.email.fromName} <${config.email.from}>`,
      to,
      subject: 'New Swap Request',
      html: `<p>Hi ${name},</p><p>You have a new swap request.</p>`,
    });
  }
}