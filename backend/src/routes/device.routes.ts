import { Router } from 'express';
import { handle } from '../lib/http.js';
import { linkDeviceSchema } from '../lib/validators.js';
import { AuthRequest, authenticateToken, requireRegisteredAccount, requireRole } from '../middleware/auth.middleware.js';
import { DeviceService } from '../services/device.service.js';

// /api/v1/devices: registered (signed-in, not demo) merchants only
const router = Router();
router.use(authenticateToken, requireRegisteredAccount, requireRole('MERCHANT'));

router.get('/', handle<AuthRequest>(async (req, res) => {
  res.json({ success: true, data: await DeviceService.list(req.user!.merchantId!) });
}));

// POST /api/v1/devices { name, serial }
router.post('/', handle<AuthRequest>(async (req, res) => {
  const input = linkDeviceSchema.parse(req.body);
  res.status(201).json({ success: true, data: await DeviceService.link(req.user!.merchantId!, input) });
}));

router.get('/:id', handle<AuthRequest>(async (req, res) => {
  res.json({ success: true, data: await DeviceService.get(req.user!.merchantId!, req.params.id as string) });
}));

router.delete('/:id', handle<AuthRequest>(async (req, res) => {
  await DeviceService.unlink(req.user!.merchantId!, req.params.id as string);
  res.json({ success: true, data: { removed: true } });
}));

// GET /api/v1/devices/:id/recipients?q=shop -> KYC-verified shops + wallet addresses
router.get('/:id/recipients', handle<AuthRequest>(async (req, res) => {
  await DeviceService.get(req.user!.merchantId!, req.params.id as string); // must own the device
  const data = await DeviceService.searchVerifiedRecipients(req.user!.merchantId!, String(req.query.q ?? ''));
  res.json({ success: true, data });
}));

export default router;
