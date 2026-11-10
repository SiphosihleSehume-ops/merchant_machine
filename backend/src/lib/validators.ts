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