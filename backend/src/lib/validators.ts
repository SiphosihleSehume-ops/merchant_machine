import { z } from 'zod';

export const createMerchantSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    name: z.string().min(2, "Business name is required"),
    fiatWallet: z.string().optional(),
    cryptoWallet: z.string().optional(),
  }),
});

export const createInvoiceSchema = z.object({
  body: z.object({
    merchantId: z.string().uuid("Invalid merchant ID"),
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