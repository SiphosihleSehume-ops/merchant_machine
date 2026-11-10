import { Router } from 'express';
import { InvoiceController } from '../controllers/invoice.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js'

const router = Router();

// POST /api/v1/invoices
router.post('/', authenticateToken, InvoiceController.create);

export default router;