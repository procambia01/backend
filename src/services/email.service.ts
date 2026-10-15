import nodemailer from 'nodemailer';
import { config } from '@/config/env';
import logger from '@/utils/logger.util';
import { tr } from '@/i18n';

interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Delivery is driver based; the `console` driver is rejected in production by the env schema. */
export class EmailService {
  private transporter?: nodemailer.Transporter;

  private getTransport(): nodemailer.Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        secure: config.email.smtp.secure,
        auth: config.email.smtp.user ? { user: config.email.smtp.user, pass: config.email.smtp.password } : undefined,
      });
    }
    return this.transporter;
  }

  private async deliver(opts: MailOptions): Promise<void> {
    const from = `${config.email.fromName} <${config.email.from}>`;
    if (config.email.driver === 'console') {
      logger.info('email (console driver)', { to: opts.to, subject: opts.subject });
      return;
    }
    if (config.email.driver === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text }),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
      return;
    }
    await this.getTransport().sendMail({ from, ...opts });
  }

  /** Never throws: email problems must not fail the business operation. */
  async safeSend(opts: MailOptions): Promise<boolean> {
    try {
      await this.deliver(opts);
      return true;
    } catch (error) {
      logger.warn('email delivery failed', { to: opts.to.replace(/(?<=.).(?=[^@]*@)/g, '*'), message: (error as Error).message });
      return false;
    }
  }

  private layout(locale: string, heading: string, bodyHtml: string, action?: { label: string; url: string }): string {
    const btn = action
      ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>`
      : '';
    return `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">${escapeHtml(heading)}</h2>${bodyHtml}${btn}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
<p style="font-size:12px;color:#64748b">${escapeHtml(tr(locale, 'email.footer'))} · cashmouver.com</p></body></html>`;
  }

  async sendVerificationEmail(to: string, name: string, token: string, locale = 'en') {
    const url = `${config.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
    return this.safeSend({
      to,
      subject: tr(locale, 'email.verify.subject'),
      html: this.layout(locale, tr(locale, 'email.verify.subject'), `<p>${escapeHtml(tr(locale, 'email.hello', { name }))}</p><p>${escapeHtml(tr(locale, 'email.verify.body'))}</p>`, {
        label: tr(locale, 'email.verify.cta'),
        url,
      }),
      text: `${tr(locale, 'email.verify.body')} ${url}`,
    });
  }

  async sendPasswordResetEmail(to: string, name: string, token: string, locale = 'en') {
    const url = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    return this.safeSend({
      to,
      subject: tr(locale, 'email.reset.subject'),
      html: this.layout(locale, tr(locale, 'email.reset.subject'), `<p>${escapeHtml(tr(locale, 'email.hello', { name }))}</p><p>${escapeHtml(tr(locale, 'email.reset.body'))}</p>`, {
        label: tr(locale, 'email.reset.cta'),
        url,
      }),
      text: `${tr(locale, 'email.reset.body')} ${url}`,
    });
  }

  async sendLoginAlert(to: string, name: string, device: string, ip: string, whenIso: string, locale = 'en') {
    return this.safeSend({
      to,
      subject: tr(locale, 'email.loginAlert.subject'),
      html: this.layout(
        locale,
        tr(locale, 'email.loginAlert.subject'),
        `<p>${escapeHtml(tr(locale, 'email.hello', { name }))}</p><p>${escapeHtml(tr(locale, 'email.loginAlert.body', { device, ip, when: whenIso }))}</p>`,
        { label: tr(locale, 'email.loginAlert.cta'), url: `${config.appUrl}/dashboard/settings` }
      ),
    });
  }

  async sendNotificationEmail(to: string, name: string, title: string, message: string, locale = 'en') {
    return this.safeSend({
      to,
      subject: title,
      html: this.layout(locale, title, `<p>${escapeHtml(tr(locale, 'email.hello', { name }))}</p><p>${escapeHtml(message)}</p>`, {
        label: tr(locale, 'email.openApp'),
        url: `${config.appUrl}/dashboard`,
      }),
    });
  }
}

export const emailService = new EmailService();
