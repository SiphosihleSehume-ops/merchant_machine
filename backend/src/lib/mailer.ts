import nodemailer, { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;
let usingEthereal = false;

function hasCustomSmtp(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, '');
  if (!host || !user || !pass) return false;
  if (user === 'you@example.com' || pass === 'app-password') return false;
  return true;
}

async function getTransporter(): Promise<Transporter> {
  if (transporter) return transporter;

  if (hasCustomSmtp()) {
    usingEthereal = false;
    const host = process.env.SMTP_HOST!.trim();
    const user = process.env.SMTP_USER!.trim();
    // Strip spaces from Google 16-character App Passwords (e.g. "abcd efgh ijkl mnop")
    const pass = process.env.SMTP_PASS!.replace(/\s+/g, '');
    const isGmail = host === 'smtp.gmail.com' || user.endsWith('@gmail.com');

    transporter = nodemailer.createTransport(
      isGmail
        ? {
            service: 'gmail',
            auth: { user, pass },
          }
        : {
            host,
            port: Number(process.env.SMTP_PORT || 587),
            secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
            auth: { user, pass },
          },
    );
    return transporter;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SMTP is not configured (set SMTP_HOST, SMTP_USER, and SMTP_PASS in backend/.env)');
  }

  // If real SMTP credentials haven't been added to backend/.env yet, create a real
  // Nodemailer Ethereal SMTP test account so emails still go through a real SMTP server.
  const testAccount = await nodemailer.createTestAccount();
  usingEthereal = true;
  transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
  console.log(`[mail] Using Nodemailer Ethereal SMTP (${testAccount.user}). Set SMTP_HOST/SMTP_USER/SMTP_PASS in backend/.env to use your own SMTP server.`);
  return transporter;
}

export const APP_URL = process.env.APP_URL || 'http://localhost:3000';

export async function sendVerificationEmail(to: string, token: string, otp: string) {
  const link = `${APP_URL}/verify-email?token=${encodeURIComponent(token)}`;

  // Automated local E2E test mode (when SMTP_HOST is explicitly empty in --e2e)
  if (process.env.E2E_LOCAL_MAIL === '1') {
    console.warn(
      `[mail] Verification OTP for ${to}: ${otp}\n` +
      `[mail] Verification link for ${to}:\n  ${link}`,
    );
    return;
  }

  const t = await getTransporter();
  const info = await t.sendMail({
    from: process.env.MAIL_FROM && !process.env.MAIL_FROM.includes('you@example.com')
      ? process.env.MAIL_FROM
      : process.env.SMTP_USER && process.env.SMTP_USER !== 'you@example.com'
        ? `"Merchant Machine" <${process.env.SMTP_USER}>`
        : '"Merchant Machine" <no-reply@merchantmachine.local>',
    to,
    subject: `${otp} is your Merchant Machine verification code`,
    text: [
      'Welcome to Merchant Machine.',
      '',
      `Your 6-digit verification code (valid for 15 minutes): ${otp}`,
      '',
      'Or verify by opening this link (valid for 24 hours):',
      link,
      '',
      'If you did not create an account, ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0e0f11;color:#f4f4f5;border-radius:14px">
        <h2 style="margin:0 0 12px">Verify your email</h2>
        <p style="color:#9a9da6">Enter this 6-digit verification code in the app to activate your Merchant Machine account:</p>
        <div style="margin:20px 0;padding:16px;background:#181a1f;border:1px solid #2a2d35;border-radius:12px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#ff7a1a">
          ${otp}
        </div>
        <p style="color:#9a9da6;font-size:13px">This code expires in 15 minutes. You can also verify by clicking the button below:</p>
        <p style="margin:20px 0">
          <a href="${link}" style="background:#ff7a1a;color:#190d02;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">Verify email</a>
        </p>
        <p style="color:#9a9da6;font-size:13px">If you did not create an account, ignore this email.</p>
      </div>`,
  });

  if (usingEthereal) {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[mail] Sent verification email to ${to}. Preview inbox message at:\n  ${previewUrl}`);
    }
  } else {
    console.log(`[mail] Sent verification email to ${to} via ${process.env.SMTP_HOST} (messageId: ${info.messageId})`);
  }
}

// ------------------------------------------------------------------
// General-purpose mail (KYC review / status notifications)
// ------------------------------------------------------------------

export function fromAddress() {
  return process.env.MAIL_FROM && !process.env.MAIL_FROM.includes('<your')
    ? process.env.MAIL_FROM
    : process.env.SMTP_USER && process.env.SMTP_USER !== 'you@example.com'
      ? `"Merchant Machine" <${process.env.SMTP_USER}>`
      : '"Merchant Machine" <no-reply@merchantmachine.local>';
}

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export { esc as escapeHtml };

/** Dark, on-brand email body with an optional call-to-action button. */
export function brandedHtml(title: string, bodyHtml: string, cta?: { label: string; href: string }) {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;background:#0e0f11;color:#f4f4f5;border-radius:14px">
      <h2 style="margin:0 0 12px">${esc(title)}</h2>
      <div style="color:#c9cbd1;line-height:1.5">${bodyHtml}</div>
      ${cta ? `<p style="margin:24px 0"><a href="${cta.href}" style="background:#ff7a1a;color:#190d02;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>` : ''}
      <p style="color:#9a9da6;font-size:12px;margin-top:24px">Merchant Machine</p>
    </div>`;
}

export async function sendMail(msg: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}) {
  const t = await getTransporter();
  const info = await t.sendMail({ from: fromAddress(), ...msg });
  if (usingEthereal) {
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log(`[mail] "${msg.subject}" to ${msg.to}. Preview: ${preview}`);
  } else {
    console.log(`[mail] Sent "${msg.subject}" to ${msg.to}`);
  }
  return info;
}
