import nodemailer, { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;
let usingEthereal = false;

const DEFAULT_PROD_APP_URL = 'https://merchant-machine.vercel.app';

function resolveAppUrl(): string {
  const raw = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (raw && !(process.env.NODE_ENV === 'production' && raw.includes('localhost'))) {
    return raw;
  }
  return process.env.NODE_ENV === 'production' ? DEFAULT_PROD_APP_URL : (raw || 'http://localhost:3000');
}

export const APP_URL = resolveAppUrl();

function getRelayEndpoint(): string {
  const base = APP_URL.startsWith('https://') ? APP_URL : DEFAULT_PROD_APP_URL;
  return `${base.replace(/\/+$/, '')}/api/mail-relay`;
}

function hasCustomSmtp(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, '');
  if (!host || !user || !pass) return false;
  if (user === 'you@example.com' || pass === 'app-password') return false;
  return true;
}

async function sendViaHttpsRelay(msg: {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}): Promise<{ messageId: string }> {
  const smtpHost = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.replace(/\s+/g, '');
  if (!smtpUser || !smtpPass) {
    throw new Error('SMTP_USER and SMTP_PASS are required for HTTPS mail relay');
  }

  const endpoint = getRelayEndpoint();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: msg.to,
      from: msg.from,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      smtpHost,
      smtpUser,
      smtpPass,
      attachments: msg.attachments?.map((a) => ({
        filename: a.filename,
        contentBase64: a.content.toString('base64'),
        contentType: a.contentType,
      })),
    }),
    signal: AbortSignal.timeout(12000),
  });

  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; messageId?: string; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTPS mail relay returned HTTP ${res.status}`);
  }
  console.log(`[mail] Sent "${msg.subject}" to ${msg.to} via HTTPS relay (${endpoint})`);
  return { messageId: data.messageId || 'relay-ok' };
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
            connectionTimeout: 4000,
            greetingTimeout: 4000,
            socketTimeout: 6000,
          }
        : {
            host,
            port: Number(process.env.SMTP_PORT || 587),
            secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
            auth: { user, pass },
            connectionTimeout: 4000,
            greetingTimeout: 4000,
            socketTimeout: 6000,
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

export function fromAddress() {
  return process.env.MAIL_FROM && !process.env.MAIL_FROM.includes('<your') && !process.env.MAIL_FROM.includes('you@example.com')
    ? process.env.MAIL_FROM
    : process.env.SMTP_USER && process.env.SMTP_USER !== 'you@example.com'
      ? `"Merchant Machine" <${process.env.SMTP_USER}>`
      : '"Merchant Machine" <no-reply@merchantmachine.local>';
}

async function deliverMail(msg: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}) {
  const from = fromAddress();
  const isRender = Boolean(process.env.RENDER);

  // Render Free Tier blocks outbound SMTP ports (25, 465, 587); use HTTPS relay first on Render
  if (isRender && hasCustomSmtp()) {
    try {
      return await sendViaHttpsRelay({ ...msg, from });
    } catch (relayErr: any) {
      console.warn(`[mail] HTTPS relay failed (${relayErr?.message}), trying direct SMTP...`);
    }
  }

  try {
    const t = await getTransporter();
    const info = await t.sendMail({ from, ...msg });
    if (usingEthereal) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log(`[mail] Sent "${msg.subject}" to ${msg.to}. Preview inbox message at:\n  ${previewUrl}`);
      }
    } else {
      console.log(`[mail] Sent "${msg.subject}" to ${msg.to} via ${process.env.SMTP_HOST} (messageId: ${info.messageId})`);
    }
    return info;
  } catch (smtpErr: any) {
    if (!isRender && hasCustomSmtp()) {
      console.warn(`[mail] Direct SMTP failed (${smtpErr?.message}), falling back to HTTPS relay...`);
      return await sendViaHttpsRelay({ ...msg, from });
    }
    throw smtpErr;
  }
}

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

  await deliverMail({
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
}

// ------------------------------------------------------------------
// General-purpose mail (KYC review / status notifications)
// ------------------------------------------------------------------

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
  return deliverMail(msg);
}
