import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { prisma } from './lib/prisma.js'; // Note the .js extension for ESM
import merchantRoutes from './routes/merchant.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import x402Routes from './routes/x402.routes.js'; // <-- ADDED MISSING IMPORT

// Load environment variables from .env file
dotenv.config();

const app = express();

// ==========================================
// MIDDLEWARE
// ==========================================

// Allow requests from your Next.js frontend (runs on localhost:3000)
app.use(cors());

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