import nodemailer, { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', // true for port 465
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

export const APP_URL = process.env.APP_URL || 'http://localhost:3000';

export async function sendVerificationEmail(to: string, token: string) {
  const link = `${APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const t = getTransporter();

  if (!t) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP is not configured (SMTP_HOST missing)');
    }
    // Dev fallback so sign-up can be tested before SMTP credentials exist
    console.warn(`[mail] SMTP_HOST not set. Verification link for ${to}:\n  ${link}`);
    return;
  }

  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: 'Verify your Merchant Machine email',
    text: `Welcome to Merchant Machine.\n\nVerify your email address by opening this link (valid for 24 hours):\n${link}\n\nIf you did not create an account, ignore this email.`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0e0f11;color:#f4f4f5;border-radius:14px">
        <h2 style="margin:0 0 12px">Verify your email</h2>
        <p style="color:#9a9da6">Welcome to Merchant Machine. Confirm your email address to finish setting up your account.</p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#ff7a1a;color:#190d02;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Verify email</a>
        </p>
        <p style="color:#9a9da6;font-size:13px">This link is valid for 24 hours. If you did not create an account, ignore this email.</p>
      </div>`,
  });
}
