import { z } from 'zod';
import { X402_NETWORK } from './x402.js';

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
    network: z.string().default(X402_NETWORK),
    payTo: z.string().min(1, "PayTo address is required"),
  }),
});

export const settlePaymentSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'txHash must be a 32-byte 0x-prefixed hex hash'),
});

// ---------------- Auth ----------------
const email = z.string().trim().toLowerCase().email('Invalid email format');

export const registerSchema = z.object({
  firstName: z.string().trim().min(1, 'Name is required').max(50, 'Name is too long'),
  lastName: z.string().trim().min(1, 'Surname is required').max(50, 'Surname is too long'),
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

export const verifyOtpSchema = z.object({
  email,
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit verification code'),
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

/**
 * PDF Section 3.6: POPIA-minimised KYC tier upgrade.
 * Never persists raw ID numbers or document scans; accepts provider attestation or consent.
 */
export const customerKycSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  countryCode: z.string().trim().length(2, 'ISO 2-letter country code required').default('ZA'),
  popiaConsent: z.literal(true, {
    errorMap: () => ({ message: 'POPIA consent is required for KYC verification' }),
  }),
});

// ---------------- Reversals ----------------
export const createReversalSchema = z.object({
  transactionId: z.string().uuid('Invalid transaction ID'),
  /** Optional partial refund amount in ZAR (defaults to full net amount minus service fee). */
  amount: z.number().positive('Refund amount must be greater than 0').optional(),
  reason: z.string().trim().max(500).optional(),
  acknowledgeNonRefundableFee: z.literal(true, {
    errorMap: () => ({ message: 'You must acknowledge that the service fee is non-refundable' }),
  }),
  /** Optional connected MetaMask wallet address to match payments made before wallet linking. */
  walletAddress: evmAddress.optional(),
  /** When true, attempts immediate on-chain treasury refund to the customer's wallet. */
  autoApprove: z.boolean().optional(),
});

export const respondReversalSchema = z
  .object({
    action: z.enum(['APPROVE', 'DECLINE']).optional(),
    status: z.enum(['APPROVED', 'DECLINED']).optional(),
    reason: z.string().trim().max(500).optional(),
    refundTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid refundTxHash').optional(),
  })
  .refine((v) => Boolean(v.action || v.status), {
    message: 'Provide action ("APPROVE" | "DECLINE") or status ("APPROVED" | "DECLINED")',
  })
  .transform((v) => ({
    decision: (v.action === 'APPROVE' || v.status === 'APPROVED' ? 'APPROVE' : 'DECLINE') as 'APPROVE' | 'DECLINE',
    reason: v.reason,
    refundTxHash: v.refundTxHash as `0x${string}` | undefined,
  }));

// ---------------- Merchant shop ----------------
export const SHOP_CATEGORIES = [
  'Spaza / Grocery',
  'Restaurant & Takeaway',
  'Coffee & Bakery',
  'Clothing & Fashion',
  'Electronics & Phones',
  'Hair & Beauty',
  'Pharmacy & Health',
  'Hardware & Building',
  'Transport',
  'Services',
  'Other',
] as const;

export const updateShopSchema = z.object({
  name: z.string().trim().min(2, 'Shop name must be at least 2 characters').max(80, 'Shop name is too long'),
  category: z.enum(SHOP_CATEGORIES, { errorMap: () => ({ message: 'Choose a shop category' }) }),
  /** Present only when the payout wallet changes: MetaMask ownership proof. */
  wallet: z
    .object({
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address'),
      issuedAt: z.string().datetime(),
      signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature'),
    })
    .optional(),
});

// ---------------- KYC (My Address) ----------------
export const SA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape',
] as const;

/** Multipart text fields (all arrive as strings). */
export const kycSubmitSchema = z.object({
  streetAddress: z.string().trim().min(3, 'Street address is required').max(120),
  suburb: z.string().trim().max(80).optional().or(z.literal('')),
  city: z.string().trim().min(2, 'City / town is required').max(80),
  province: z.enum(SA_PROVINCES, { errorMap: () => ({ message: 'Choose a province' }) }),
  postalCode: z.string().trim().regex(/^\d{4}$/, 'Postal code must be 4 digits'),
  country: z.literal('South Africa').default('South Africa'),
  popiaConsent: z.literal('true', { errorMap: () => ({ message: 'You must consent to processing your documents (POPIA)' }) }),
});

export const kycRejectSchema = z.object({
  reason: z.string().trim().min(3, 'Give the applicant a reason').max(300),
});

// ---------------- Devices ----------------
export const linkDeviceSchema = z.object({
  name: z.string().trim().min(2, 'Give the device a name').max(60),
  serial: z.string().trim().regex(/^[A-Za-z0-9-]{6,32}$/, 'Serial number must be 6-32 letters or digits'),
});

// ---------------- Business accounts (branches) ----------------
export const addBranchSchema = z.object({
  name: z.string().trim().min(2, 'Business name must be at least 2 characters').max(80),
  category: z.enum(SHOP_CATEGORIES, { errorMap: () => ({ message: 'Choose a category' }) }),
  wallet: z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address'),
    issuedAt: z.string().datetime(),
    signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature'),
  }),
});
