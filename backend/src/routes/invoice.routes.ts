import { Router } from 'express';
import { InvoiceController } from '../controllers/invoice.controller.js';

const router = Router();

// POST /api/v1/invoices
router.post('/', InvoiceController.create);

export default router;