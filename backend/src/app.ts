// Must be the first import: other modules read process.env at load time
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './lib/prisma.js'; // Note the .js extension for ESM
import merchantRoutes from './routes/merchant.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import x402Routes from './routes/x402.routes.js';
import { kycRouter, adminKycRouter } from './routes/kyc.routes.js';
import deviceRoutes from './routes/device.routes.js';
import authRoutes from './routes/auth.routes.js';
import customerRoutes from './routes/customer.routes.js';
import { reversalsRouter, transactionsRouter } from './routes/payments.routes.js';


const app = express();

// ==========================================
// MIDDLEWARE
// ==========================================

// Allow requests from your Next.js frontend (runs on localhost:3000)
// Development: accept the app from localhost, 127.0.0.1 or a LAN IP (phones) so the
// browser never blocks API calls ("Can't reach the server"). Production: CORS_ORIGIN only.
const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? corsOrigins ?? false : true,
  // Browser x402 clients must be able to read the challenge and receipt headers
  exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
}));

// Parse incoming JSON payloads automatically
app.use(express.json());

// ==========================================
// CORE ROUTES
// ==========================================

// 1. Health Check Endpoint
// Used to verify the server is running (e.g., for deployment platforms)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'Merchant Machine API is running' 
  });
});

// 2. Database Connection Test
// Used to verify Express can successfully talk to Neon via Prisma
app.get('/api/v1/db-status', async (req, res) => {
  try {
    // Attempt to count merchants in the database
    const merchantCount = await prisma.merchant.count();
    
    res.status(200).json({ 
      status: 'connected', 
      database: 'Neon PostgreSQL',
      merchantCount 
    });
  } catch (error: any) {
    console.error('Database connection error:', error);
    res.status(500).json({ 
      error: 'Database connection failed', 
      details: error.message 
    });
  }
});

// ==========================================
// FEATURE ROUTES
// ==========================================

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/transactions', transactionsRouter);
app.use('/api/v1/reversals', reversalsRouter);
app.use('/api/v1/kyc', kycRouter);
app.use('/api/v1/admin/kyc', adminKycRouter);
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/v1/merchants', merchantRoutes);
app.use('/api/v1/invoices', invoiceRoutes); // <-- CLEANED UP (removed duplicate)
app.use('/api/v1/x402', x402Routes);       // <-- ADDED X402 ROUTES

// ==========================================
// ERROR HANDLING
// ==========================================

// Global Error Handler
// This catches any errors thrown by your routes so the server doesn't crash
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

export default app;