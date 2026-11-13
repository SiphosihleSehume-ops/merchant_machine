// Sends the reviewer email (documents attached + review link) for every KYC application
// that is still PENDING, e.g. ones submitted before email review existed.
// Usage (from backend/): npx tsx scripts/send-kyc-reviews.ts
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { readDecrypted } from '../src/lib/kycStorage.js';
import { notifySubmitted, reviewerEmail } from '../src/lib/kycEmails.js';

const pending = await prisma.kycApplication.findMany({
  where: { status: 'PENDING' },
  include: { user: { select: { email: true, merchant: { select: { name: true } } } } },
});
console.log(`${pending.length} pending application(s); reviewer inbox: ${reviewerEmail() || '(none set)'}`);

for (const a of pending) {
  try {
    const [id, proof] = await Promise.all([readDecrypted(a.idDocumentFile), readDecrypted(a.proofOfAddressFile)]);
    notifySubmitted(a, { email: a.user.email, shopName: a.user.merchant?.name ?? null }, {
      id, idMime: a.idDocumentMime, proof, proofMime: a.proofOfAddressMime,
    });
    console.log(`  queued review email for ${a.user.email}`);
  } catch (error) {
    console.error(`  could not prepare ${a.user.email}: ${(error as Error).message}`);
  }
}
// Give the mailer time to finish sending before exiting
await new Promise((r) => setTimeout(r, 15_000));
await prisma.$disconnect();
