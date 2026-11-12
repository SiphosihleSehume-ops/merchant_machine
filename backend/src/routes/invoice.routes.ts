import { Router } from 'express';
import { InvoiceController } from '../controllers/invoice.controller.js';
import { AuthRequest, authenticateToken, requireRole } from '../middleware/auth.middleware.js';
import { InvoiceService } from '../services/invoice.service.js';
import { handle } from '../lib/http.js';

const router = Router();

// POST /api/v1/invoices
router.post('/', authenticateToken, requireRole('MERCHANT'), InvoiceController.create);

// GET /api/v1/invoices/:id  (merchant's own invoices only)
router.get('/:id', authenticateToken, requireRole('MERCHANT'), handle<AuthRequest>(async (req, res) => {
  const invoice = await InvoiceService.getForMerchant(req.params.id as string, req.user!.merchantId!);
  if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
  res.json({ success: true, data: invoice });
}));

export default router;