import jwt from 'jsonwebtoken';
import { APP_URL, brandedHtml, escapeHtml as esc, sendMail } from './mailer.js';
import { getJwtSecret } from '../middleware/auth.middleware.js';
import { HttpError } from './x402.js';

/**
 * Email-based KYC review (simulates a real compliance inbox):
 *  - the reviewer (KYC_REVIEWER_EMAIL, default SMTP_USER) gets the documents attached and a
 *    link to a review page where they approve or reject;
 *  - the applicant gets "under review", then "verified" / "not approved" emails.
 *
 * The review link carries a signed token (7 days). It opens a page with buttons rather than
 * approving directly, because mail scanners pre-open links.
 */
export const reviewerEmail = () => (process.env.KYC_REVIEWER_EMAIL || process.env.SMTP_USER || '').trim();

const REVIEW_TTL = '7d';

export function createReviewToken(applicationId: string) {
  return jwt.sign({ purpose: 'kyc-review', applicationId }, getJwtSecret(), { expiresIn: REVIEW_TTL });
}

export function readReviewToken(token: string): string {
  try {
    const p = jwt.verify(token, getJwtSecret()) as { purpose?: string; applicationId?: string };
    if (p.purpose !== 'kyc-review' || !p.applicationId) throw new Error('wrong purpose');
    return p.applicationId;
  } catch {
    throw new HttpError(401, 'This review link is invalid or has expired.', 'REVIEW_LINK_INVALID');
  }
}

type AppSummary = {
  id: string;
  walletAddress: string;
  streetAddress: string;
  suburb: string | null;
  city: string;
  province: string;
  postalCode: string;
  createdAt: Date;
};

const ext = (mime: string) => (mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg');

/** Never let an email problem break the KYC flow itself. */
function safely(label: string, p: Promise<unknown>) {
  p.catch((error) => console.error(`[kyc-mail] ${label} failed: ${error?.message ?? error}`));
}

export function notifySubmitted(
  app: AppSummary,
  applicant: { email: string; shopName: string | null },
  docs: { id: Buffer; idMime: string; proof: Buffer; proofMime: string },
) {
  const address = [app.streetAddress, app.suburb, app.city, app.province, app.postalCode].filter(Boolean).join(', ');
  const reviewUrl = `${APP_URL}/kyc/review?token=${encodeURIComponent(createReviewToken(app.id))}`;
  const to = reviewerEmail();

  if (to) {
    safely(
      'reviewer email',
      sendMail({
        to,
        subject: `KYC review needed: ${applicant.shopName ?? applicant.email}`,
        text: [
          'A new KYC application is waiting for review.',
          '',
          `Applicant: ${applicant.email}`,
          `Business: ${applicant.shopName ?? '-'}`,
          `Wallet: ${app.walletAddress}`,
          `Address: ${address}`,
          '',
          'The ID document and proof of address are attached.',
          `Review and approve or reject (link valid 7 days): ${reviewUrl}`,
        ].join('\n'),
        html: brandedHtml(
          'KYC review needed',
          `<p>A new application is waiting for your decision.</p>
           <table style="color:#f4f4f5;font-size:14px;border-collapse:collapse">
             <tr><td style="color:#9a9da6;padding:4px 12px 4px 0">Applicant</td><td>${esc(applicant.email)}</td></tr>
             <tr><td style="color:#9a9da6;padding:4px 12px 4px 0">Business</td><td>${esc(applicant.shopName ?? '-')}</td></tr>
             <tr><td style="color:#9a9da6;padding:4px 12px 4px 0">Wallet</td><td style="font-family:monospace">${esc(app.walletAddress)}</td></tr>
             <tr><td style="color:#9a9da6;padding:4px 12px 4px 0">Address</td><td>${esc(address)}</td></tr>
           </table>
           <p>The <strong>ID document</strong> and <strong>proof of address</strong> are attached. Check them, then approve or reject.</p>
           <p style="color:#9a9da6;font-size:12px">Contains personal information (POPIA). Don't forward this email; delete it after review.</p>`,
          { label: 'Review application', href: reviewUrl },
        ),
        attachments: [
          { filename: `id-document.${ext(docs.idMime)}`, content: docs.id, contentType: docs.idMime },
          { filename: `proof-of-address.${ext(docs.proofMime)}`, content: docs.proof, contentType: docs.proofMime },
        ],
      }),
    );
  } else {
    console.warn('[kyc-mail] No reviewer email (set KYC_REVIEWER_EMAIL or SMTP_USER). Review link:', reviewUrl);
  }

  safely(
    'applicant "under review" email',
    sendMail({
      to: applicant.email,
      subject: 'Your Merchant Machine account is being reviewed',
      text: [
        `Thanks for submitting your verification${applicant.shopName ? ` for ${applicant.shopName}` : ''}.`,
        '',
        'Your documents are with our reviewer. We will email you as soon as a decision is made.',
        `Wallet being verified: ${app.walletAddress}`,
      ].join('\n'),
      html: brandedHtml(
        'Your account is being reviewed',
        `<p>Thanks for submitting your verification${applicant.shopName ? ` for <strong>${esc(applicant.shopName)}</strong>` : ''}.</p>
         <p>Your documents are with our reviewer. We'll email you as soon as a decision is made.</p>
         <p style="color:#9a9da6;font-size:13px">Wallet being verified: <span style="font-family:monospace">${esc(app.walletAddress)}</span></p>`,
        { label: 'Check status', href: `${APP_URL}/profile/address` },
      ),
    }),
  );
}

export function notifyDecision(
  applicant: { email: string; shopName: string | null },
  decision: { approved: true; explorerUrl: string | null } | { approved: false; reason: string },
) {
  const mail = decision.approved
    ? {
        subject: "You're verified on Merchant Machine",
        text: `Good news: your KYC was approved${applicant.shopName ? ` for ${applicant.shopName}` : ''}. Your wallet is now recorded as verified on the blockchain.${decision.explorerUrl ? `\n\nTransaction: ${decision.explorerUrl}` : ''}`,
        html: brandedHtml(
          "You're verified",
          `<p>Good news: your KYC was approved${applicant.shopName ? ` for <strong>${esc(applicant.shopName)}</strong>` : ''}.</p>
           <p>Your wallet is now recorded as verified on the blockchain. You can add business accounts and receive transfers from other verified shops.</p>
           ${decision.explorerUrl ? `<p><a href="${decision.explorerUrl}" style="color:#ff7a1a">View the on-chain record</a></p>` : ''}`,
          { label: 'Open the app', href: `${APP_URL}/profile/address` },
        ),
      }
    : {
        subject: 'Your Merchant Machine verification was not approved',
        text: `Your KYC application was not approved.\n\nReason: ${decision.reason}\n\nYou can fix this and submit again in the app (Profile > My address).`,
        html: brandedHtml(
          'Verification not approved',
          `<p>Your KYC application was not approved.</p>
           <p style="padding:12px;background:#2a1414;border-radius:10px"><strong>Reason:</strong> ${esc(decision.reason)}</p>
           <p>You can fix this and submit again under <strong>Profile → My address</strong>.</p>`,
          { label: 'Submit again', href: `${APP_URL}/profile/address` },
        ),
      };
  safely('applicant decision email', sendMail({ to: applicant.email, ...mail }));
}
