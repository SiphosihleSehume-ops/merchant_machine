import { z } from 'zod';

// Merchant registration schema
export const createMerchantSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    name: z.string().min(2, "Business name is required"),
    fiatWallet: z.string().optional(),
    cryptoWallet: z.string().optional(),
  }),
});

// Invoice creation schema
export const createInvoiceSchema = z.object({
  body: z.object({
    currency: z.string().default("ZAR"),
    items: z.array(
      z.object({
        name: z.string().min(1, "Item name is required"),
        quantity: z.number().int().positive("Quantity must be at least 1"),
        unitPrice: z.number().positive("Unit price must be greater than 0"),
      })
    ).min(1, "Invoice must have at least one item"),
  }),
});

// Payment intent creation schema
export const createIntentSchema = z.object({
  body: z.object({
    invoiceId: z.string().uuid("Invalid invoice ID"),
    network: z.string().default("eip155:84532"), // Base Sepolia
    payTo: z.string().min(1, "PayTo address is required"),
  }),
});
// ---------------- Auth ----------------
const email = z.string().trim().toLowerCase().email('Invalid email format');

export const registerSchema = z.object({
  email,
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export const emailOnlySchema = z.object({ email });

export const verifyEmailSchema = z.object({
  token: z.string().min(32, 'Invalid verification token'),
});

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address');

export const selectRoleSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('CUSTOMER') }),
  z.object({
    role: z.literal('MERCHANT'),
    // Required only the first time (when the merchant profile is created)
    businessName: z.string().trim().min(2, 'Business name is required').max(80).optional(),
    cryptoWallet: evmAddress.optional(),
  }),
]);

// ---------------- Customer ----------------
export const linkWalletSchema = z.object({
  address: evmAddress,
  /** ISO timestamp embedded in the signed message (replay window). */
  issuedAt: z.string().datetime(),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature'),
});

// ---------------- Reversals ----------------
export const createReversalSchema = z.object({
  transactionId: z.string().uuid('Invalid transaction ID'),
  reason: z.string().trim().max(500).optional(),
  acknowledgeNonRefundableFee: z.literal(true, {
    errorMap: () => ({ message: 'You must acknowledge that the service fee is non-refundable' }),
  }),
});
