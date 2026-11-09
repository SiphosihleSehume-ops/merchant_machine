# Merchant & Payment Machine

> A next-generation payment infrastructure for merchants to accept fiat and cryptocurrency, settling directly into their own wallets with zero custodial risk.

## 📖 Overview

The **Merchant & Payment Machine** solves the fragmentation of merchant payment processing. Instead of managing separate POS systems for fiat and crypto, merchants use a single interface to generate secure invoices. Customers can pay using their traditional bank cards or by scanning a QR code with a Web3 wallet.

Powered by the **x402 protocol**, crypto payments are settled on-chain near-instantly, eliminating chargeback risk and providing merchants with a transparent, double-entry ledger of all transactions and platform fees.

## ✨ Key Features

- **Dual-Rail Payments:** Accept both fiat and crypto (USDC via x402).
- **Secure Invoicing:** Server-side mathematical calculations to prevent client-side tampering. Invoices expire automatically.
- **x402 Protocol Integration:** Generates standard HTTP `402 Payment Required` challenges for Web3 wallets.
- **Double-Entry Ledger:** Immutable financial records tracking platform fees (3% markup) and merchant payables.
- **Merchant-Approved Reversals:** A safe refund flow that avoids insecure `transferFrom` smart contract calls.
- **Modern UI:** A sleek, responsive Next.js frontend designed for both merchants and customers.

## 🏗 System Architecture

The project is structured as a monorepo containing the frontend Next.js application and the Express backend.

```text
merchant_machine/
├── app/                  # Next.js Frontend (App Router)
├── components/           # React UI Components
├── backend/              # Express.js + Prisma Backend
│   ├── src/              # API Source Code (Controllers, Services, Routes)
│   └── prisma/           # Database Schema & Migrations
├── contracts/            # Smart Contracts / x402 configurations
└── package.json          # Frontend dependencies


The Payment Flow
Merchant logs in and creates an Invoice.

Backend calculates the total and generates a single-use Invoice ID (QR Code).

Customer scans the QR code.

The backend returns an HTTP 402 Payment Required response with the x402 payment terms.

The customer's wallet signs the transaction and pays via the x402 facilitator.

The backend verifies the payment, marks the invoice as PAID, and updates the Double-Entry Ledger.

💻 Tech Stack
Layer	Technology
Frontend	Next.js 14, React, TypeScript, CSS
Backend	Node.js, Express.js, TypeScript
Database	PostgreSQL (Hosted on Neon)
ORM	Prisma
Crypto Protocol	x402 (Coinbase / Base Sepolia)
Validation & Auth	Zod, Bcrypt
🚀 Getting Started
Prerequisites
Node.js (v20+)

pnpm (Package Manager)

A PostgreSQL Database (We recommend a free Neon.tech database)

1. Installation
Clone the repository and install the frontend dependencies:

bash
git clone https://github.com/SiphosihleSehume-ops/merchant_machine.git
cd merchant_machine
pnpm install
2. Setup the Backend
Navigate to the backend folder and install its dependencies:

bash
cd backend
pnpm install
Create a .env file in the backend/ directory and add your database connection string:

env
DATABASE_URL="postgresql://user:password@your-neon-host.neon.tech/neondb?sslmode=require"
PORT=4000
Push the Prisma schema to your database and start the API server:

bash
npx prisma migrate dev
pnpm dev
(The backend will run on http://localhost:4000)

3. Setup the Frontend
Open a new terminal window, navigate back to the root folder, and start the Next.js app:

bash
cd ..
pnpm dev
(The frontend will run on http://localhost:3000)

📡 API Reference (Backend)
You can test the backend endpoints using Postman or the test.http file included in the backend/ folder.

POST /api/v1/merchants/register — Register a new merchant.

POST /api/v1/invoices — Create a secure, server-calculated invoice.

POST /api/v1/x402/intent — Generate an x402 payment intent.

GET /api/v1/x402/pay/:invoiceId — Returns the 402 Payment Required challenge.

POST /api/v1/x402/settle/:invoiceId — Settles the payment and updates the ledger.

🔒 Security & Compliance
Non-Custodial: Funds settle directly to the merchant's registered wallet. The platform never holds the merchant's funds.

Server-Side Truth: All invoice totals and fee calculations (3% markup) are calculated securely on the server.

Auditable: The double-entry ledger ensures that every cent is accounted for, simplifying accounting and tax compliance.

📄 License
This project is licensed under the MIT License.

text

---

### What to do next:
1. Save the file.
2. Go to your terminal (root folder).
3. Run `git add .`, `git commit -m "docs: upgrade root README with full project overview"`, and `git push origin Backend` (or `main` if you merged the PR already).
4. Refresh your GitHub page and look at how professional your repository looks now!

Let me know when you've pushed it. Then we can decide if we want to tackle the **Reversal Flow** or **JWT Authentication** next.
