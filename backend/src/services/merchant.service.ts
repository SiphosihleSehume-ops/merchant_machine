import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client'; // <-- Import Prisma
import bcrypt from 'bcrypt';

export class MerchantService {
  static async registerMerchant(data: any) {
    const { email, password, name, fiatWallet, cryptoWallet } = data;

    // 1. Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new Error('A user with this email already exists');
    }

    // 2. Hash the password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Create User and Merchant in a single transaction
    const newMerchant = await prisma.$transaction(async (tx: Prisma.TransactionClient) => { // <-- Added type here
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: 'MERCHANT',
          kycStatus: 'VERIFIED', // Auto-verify for demo purposes
        },
      });

      const merchant = await tx.merchant.create({
        data: {
          userId: user.id,
          name,
          fiatWallet,
          cryptoWallet,
          feePercentage: 3.0, // From PDF Section 3.4
        },
      });

      return { user, merchant };
    });

    // Return safe data (never return passwordHash)
    return {
      id: newMerchant.merchant.id,
      userId: newMerchant.user.id,
      email: newMerchant.user.email,
      name: newMerchant.merchant.name,
      feePercentage: newMerchant.merchant.feePercentage,
    };
  }
}