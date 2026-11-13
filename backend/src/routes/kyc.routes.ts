import { Router } from 'express';
import multer from 'multer';
import { handle } from '../lib/http.js';
import { HttpError } from '../lib/x402.js';
import { MAX_DOC_BYTES } from '../lib/kycStorage.js';
import { requireAdmin } from '../lib/admin.js';
import { readReviewToken, reviewerEmail } from '../lib/kycEmails.js';
import { kycRejectSchema, kycSubmitSchema, SA_PROVINCES } from '../lib/validators.js';
import { AuthRequest, authenticateToken } from '../middleware/auth.middleware.js';
import { KycService } from '../services/kyc.service.js';

// Documents are held in memory only until encrypted to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC_BYTES, files: 2, fields: 10 },
});
const kycFiles = upload.fields([
  { name: 'idDocument', maxCount: 1 },
  { name: 'proofOfAddress', maxCount: 1 },
]);

function activeRole(req: AuthRequest) {
  const role = req.user?.role;
  if (!role) throw new HttpError(403, 'Choose a role first', 'ROLE_REQUIRED');
  return role;
}

// ---------------- Applicant: /api/v1/kyc ----------------
export const kycRouter = Router();

// GET /api/v1/kyc/me -> latest application, wallet and on-chain status
kycRouter.get('/me', authenticateToken, handle<AuthRequest>(async (req, res) => {
  const data = await KycService.getMine(req.user!.userId, activeRole(req));
  res.json({ success: true, data: { ...data, provinces: SA_PROVINCES } });
}));

// POST /api/v1/kyc  multipart: address fields + idDocument + proofOfAddress (PDF/JPG/PNG, 5 MB each)
kycRouter.post(
  '/',
  authenticateToken,
  (req, res, next) =>
    kycFiles(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each document must be 5 MB or smaller' : `Upload error: ${err.message}`;
        return res.status(400).json({ success: false, error: msg });
      }
      if (err) return next(err);
      next();
    }),
  handle<AuthRequest>(async (req, res) => {
    const { popiaConsent: _c, ...address } = kycSubmitSchema.parse(req.body);
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const application = await KycService.submit(req.user!.userId, activeRole(req), address, {
      idDocument: files?.idDocument?.[0],
      proofOfAddress: files?.proofOfAddress?.[0],
    });
    res.status(201).json({ success: true, data: application });
  }),
);

// ---------------- Verifier: /api/v1/admin/kyc ----------------
export const adminKycRouter = Router();
adminKycRouter.use(authenticateToken, requireAdmin);

const STATUSES = ['PENDING', 'APPROVING', 'APPROVED', 'REJECTED'] as const;

// GET /api/v1/admin/kyc?status=PENDING
adminKycRouter.get('/', handle<AuthRequest>(async (req, res) => {
  const s = String(req.query.status || 'PENDING').toUpperCase();
  const status = s === 'ALL' ? undefined : STATUSES.find((x) => x === s);
  if (s !== 'ALL' && !status) throw new HttpError(400, 'Unknown status filter');
  res.json({ success: true, data: await KycService.list(status) });
}));

// GET /api/v1/admin/kyc/:id/documents/:kind  (kind = id | proof) -> decrypted file
adminKycRouter.get('/:id/documents/:kind', handle<AuthRequest>(async (req, res) => {
  const kind = req.params.kind;
  if (kind !== 'id' && kind !== 'proof') throw new HttpError(400, 'Unknown document');
  const doc = await KycService.document(req.params.id as string, kind);
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'no-store'); // never cache identity documents
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(doc.data);
}));

// POST /api/v1/admin/kyc/:id/approve -> writes the wallet to the KYCVerification contract
adminKycRouter.post('/:id/approve', handle<AuthRequest>(async (req, res) => {
  res.json({ success: true, data: await KycService.approve(req.params.id as string, req.user!.email ?? 'unknown') });
}));

// POST /api/v1/admin/kyc/:id/reject { reason }
adminKycRouter.post('/:id/reject', handle<AuthRequest>(async (req, res) => {
  const { reason } = kycRejectSchema.parse(req.body);
  res.json({ success: true, data: await KycService.reject(req.params.id as string, req.user!.email ?? 'unknown', reason) });
}));

// ---------------- Email review: /api/v1/kyc-review/:token ----------------
// The signed link emailed to the reviewer is the authorisation (no login needed).
export const emailReviewRouter = Router();
const reviewerLabel = () => `email:${reviewerEmail() || 'reviewer'}`;

// GET summary of the application behind the link
emailReviewRouter.get('/:token', handle(async (req, res) => {
  const id = readReviewToken(req.params.token as string);
  res.json({ success: true, data: await KycService.reviewSummary(id) });
}));

// GET decrypted document (id | proof)
emailReviewRouter.get('/:token/documents/:kind', handle(async (req, res) => {
  const id = readReviewToken(req.params.token as string);
  const kind = req.params.kind;
  if (kind !== 'id' && kind !== 'proof') throw new HttpError(400, 'Unknown document');
  const doc = await KycService.document(id, kind);
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(doc.data);
}));

// POST approve -> records the wallet on-chain immediately
emailReviewRouter.post('/:token/approve', handle(async (req, res) => {
  const id = readReviewToken(req.params.token as string);
  res.json({ success: true, data: await KycService.approve(id, reviewerLabel()) });
}));

// POST reject { reason }
emailReviewRouter.post('/:token/reject', handle(async (req, res) => {
  const id = readReviewToken(req.params.token as string);
  const { reason } = kycRejectSchema.parse(req.body);
  res.json({ success: true, data: await KycService.reject(id, reviewerLabel(), reason) });
}));
