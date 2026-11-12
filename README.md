# Merchant & Payment Machine

> A dual-role (Merchant + Customer) payment application and x402 resource server enabling instant digital rand (`ZARK`) and `USDC` payments with gasless EIP-3009 signatures, server-verified invoicing, an immutable double-entry ledger, and merchant-consented reversals.

## Overview

The **Merchant & Payment Machine** provides a unified payment flow for merchants and customers:

- **Gasless x402 Payments:** Customers sign an off-chain EIP-3009 `transferWithAuthorization` payload in MetaMask. A self-hosted in-process x402 facilitator verifies and settles the payment on-chain so the customer pays **zero gas**.
- **Invoice Integrity (PDF §3.5):** Invoices are calculated on the server using exact `Prisma.Decimal` arithmetic and expire after 15 minutes. Each QR code encodes only the single-use `/api/v1/x402/pay/:invoiceId` URL—never a raw amount—and displays the verified merchant name and wallet before the customer signs.
- **Single Fee Schedule & Double-Entry Ledger (PDF §3.4 & §3.8):** A single **3.0% service fee** (paid by the merchant) is split atomically into `MERCHANT_PAYABLE` (97%) and `PLATFORM_FEE` (3%) in the `LedgerEntry` table upon settlement.
- **Safe Merchant-Approved Reversals (PDF §3.2 & §3.3):** Never uses `transferFrom`. Customers acknowledge the non-refundable service fee before submitting a reversal request (full or partial net amount) with a configurable merchant approval timeout (`REVERSAL_APPROVAL_HOURS`). When the merchant approves, the platform treasury executes a new on-chain refund transaction back to the customer and records reversing `DEBIT` entries in the ledger.
- **POPIA-Minimised Tiered KYC & Non-Custodial Wallets (PDF §3.6):** Customers link non-custodial EVM wallets via EIP-191 ownership signatures and progress from `TIER_1_BASIC` to `TIER_2_VERIFIED` without storing raw ID documents.
- **Idempotent Webhooks (PDF §3.8):** Settlement and reversal transitions emit deduplicated `WebhookEvent` records (`payment.settled`, `payment.failed`, `reversal.requested`, `reversal.declined`, `reversal.completed`, `reversal.failed`, `reversal.expired`).

## System Architecture

```text
merchant_machine/
├── app/                  # Next.js 16 Frontend (App Router: Merchant & Customer shells)
├── components/           # Shared React UI Components (AuthGate, QrScanner, headers, nav)
├── lib/                  # Frontend API client, auth context, MetaMask + x402 client helpers
├── backend/              # Express.js + Prisma Backend & Self-Hosted x402 Facilitator
│   ├── src/              # Controllers, Services, Middleware, Routes, Validators
│   ├── prisma/           # PostgreSQL Schema & Migrations
│   └── scripts/          # Local E2E test suite (e2e-local.ts)
└── contracts/            # Hardhat 3 + TestStablecoin (EIP-3009 + EIP-2612: ZARK, USDC, NGN)
```

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Viem, `jsqr`, `qrcode.react` |
| **Backend** | Node.js, Express 5, TypeScript, Zod, Bcrypt, JWT, Nodemailer |
| **Database & ORM** | PostgreSQL, Prisma 6 (`Decimal(18, 6)` financial precision) |
| **x402 & Blockchain** | `@x402/express`, `@x402/core`, `@x402/evm`, Viem, Hardhat 3, OpenZeppelin 5 (Ethereum Sepolia `11155111` / Hardhat `31337`) |

## Getting Started

### Quick Start (Single-Command Launcher)

You can boot the entire stack (dependencies, local PostgreSQL via Docker, local Hardhat chain + contract deployments, Prisma migrations, Backend API, and Next.js Frontend) with a single script:

```bash
./run-all.sh          # Start full local stack (Hardhat + DB + Backend :4000 + Frontend :3000)
./run-all.sh --e2e    # Start local stack and run the full end-to-end test suite
./run-all.sh --sepolia # Start Backend + Frontend using existing Sepolia .env files
```

### Manual Setup

#### Prerequisites

- **Node.js** (v20+)
- **pnpm** (or npm)
- **PostgreSQL** database (local or hosted on Neon)

### 1. Deploy Testnet Stablecoins (`contracts/`)

Deploy `ZARK` (1:1 ZAR), `USDC`, and `NGN` EIP-3009 test tokens to Ethereum Sepolia or a local Hardhat node:

```bash
cd contracts
npm install
# For a local chain: npx hardhat node (in another terminal)
npx hardhat run scripts/deploy.ts --network localhost
# Or for Sepolia (after configuring contracts/.env from contracts/env.example):
# npx hardhat run scripts/deploy.ts --network sepolia
```

Copy the printed `TOKEN_ZARK_ADDRESS`, `TOKEN_USDC_ADDRESS`, and `TOKEN_NGN_ADDRESS` values into `backend/.env` and `.env.local`.

### 2. Setup the Backend (`backend/`)

```bash
cd ../backend
pnpm install
cp env.example .env
```

Configure `backend/.env` (see [backend/env.example](file:///home/g33k/Projects/merchant_machine/backend/env.example) for all options):

```env
DATABASE_URL="postgresql://user:password@localhost:5432/merchant_machine"
JWT_SECRET="change-me-to-a-long-random-string"
PORT=4000
CORS_ORIGIN="http://localhost:3000"
APP_URL="http://localhost:3000"

CHAIN_ID=11155111
SEPOLIA_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/<key>"
FACILITATOR_PRIVATE_KEY="0x..."

TOKEN_ZARK_ADDRESS="0x..."
TOKEN_USDC_ADDRESS="0x..."
TOKEN_NGN_ADDRESS="0x..."

ZAR_PER_USD=18.50
REVERSAL_APPROVAL_HOURS=24
```

Run migrations and start the API server:

```bash
npx prisma migrate deploy
pnpm dev
```

The backend listens on `http://localhost:4000`.

### 3. Setup the Frontend (root)

```bash
cd ..
pnpm install
cp env.example .env.local
pnpm dev
```

The frontend runs on `http://localhost:3000`.

## API Reference (`backend/`)

### Auth & Role Selection (`/api/v1/auth`)
- `POST /api/v1/auth/register` — Register with `{ email, password }` and send a single-use verification link.
- `POST /api/v1/auth/verify-email` — Verify email with `{ token }`.
- `POST /api/v1/auth/resend-verification` — Resend verification email.
- `POST /api/v1/auth/login` — Sign in with `{ email, password }`.
- `POST /api/v1/auth/select-role` — Choose active role (`CUSTOMER` or `MERCHANT` with `{ businessName, cryptoWallet }`).
- `GET /api/v1/auth/me` — Current user, active role, KYC status, and linked profiles.

### Customer Onboarding, Wallet & KYC (`/api/v1/customers`)
- `GET /api/v1/customers/me` — Customer profile, linked non-custodial wallet, and KYC tier limits (`TIER_1_BASIC` / `TIER_2_VERIFIED`).
- `POST /api/v1/customers/me/kyc` — Submit POPIA-minimised KYC attestation (`{ fullName, countryCode, popiaConsent: true }`).
- `PUT /api/v1/customers/me/wallet` — Link a non-custodial EVM wallet via EIP-191 signature (`{ address, issuedAt, signature }`).

### Invoices & x402 Payments (`/api/v1/invoices`, `/api/v1/x402`)
- `POST /api/v1/invoices` — *(Merchant)* Create a server-calculated multi-item invoice with 15-minute expiry.
- `GET /api/v1/invoices/:id` — *(Merchant)* Poll invoice status, fee breakdown, and settlement receipt.
- `GET /api/v1/x402/pay/:invoiceId` — Issues the `402 Payment Required` challenge (with merchant name, wallet, items, 3% service fee, and `ZARK`/`USDC` quotes) and, when retried with a signed `PAYMENT-SIGNATURE` header, verifies and settles on-chain via the facilitator.
- `POST /api/v1/x402/intent` — *(Authenticated)* Create an explicit x402 payment intent record.
- `POST /api/v1/x402/settle/:invoiceId` — *(Authenticated)* Record manual/fallback settlement by `txHash`.

### Transactions, Reversals & Ledger (`/api/v1/transactions`, `/api/v1/reversals`, `/api/v1/merchants`)
- `GET /api/v1/transactions` — List transactions (`PENDING`, `SETTLED`, `FAILED`, `REVERSED`) scoped to the active merchant or customer.
- `POST /api/v1/reversals` — *(Customer)* Request a full or partial reversal after acknowledging the non-refundable service fee (`{ transactionId, amount?, reason?, acknowledgeNonRefundableFee: true }`).
- `GET /api/v1/reversals` — List reversals scoped to the active merchant or customer (auto-expiring stale requests past `expiresAt`).
- `PATCH /api/v1/reversals/:id` — *(Merchant)* Approve or decline a pending reversal (`{ action: "APPROVE" | "DECLINE", reason? }`). Approval executes an on-chain refund from the platform treasury and records reversing `DEBIT` ledger entries.
- `GET /api/v1/merchants/me/ledger` — *(Merchant)* View double-entry ledger balances (`merchantPayable`, `platformFees`, `merchantReserve`) and entry history.
- `GET /api/v1/merchants/me/webhooks` — *(Merchant)* View idempotent webhook events.

## License

# Merchant & Payment Machine: front end

Next.js (App Router) + TypeScript. Mobile-first merchant UI, dark theme with an orange accent.

    npm install
    npm run dev      # http://localhost:3000

## Where things live
- `app/globals.css`: all design tokens (colours, radii, spacing) at the top. Change `--accent` to re-theme.
- `components/Logo.tsx`: placeholder brand mark. Replace its contents with the real logo.
- `lib/data.ts`: placeholder data (merchant, suppliers, transactions...). Swap for API calls.
- `lib/nav.ts`: home tile list, also reused by the Menu page.
- `app/<route>/page.tsx`: one folder per screen.

## Screens
Home, Suppliers (sort / distance / favourites + search), Top ups, Transfers, History,
Stock advance, Money transfer (+ per-country stub), Accounts, Orders, Profile, Devices,
Inbox, Share code (QR), Request payment, Cart, Scan, Menu.


## 🧪 Testnet setup (Ethereum Sepolia, own tokens)

Three packages: `contracts/` (Hardhat 3, npm), `backend/` (Express, pnpm) and the Next.js app at the root (npm).

**1. Deploy the test tokens** (ZARK, USDC mock, NGN; 6 decimals, EIP-3009, EIP-2612, public faucet)

```bash
cd contracts && npm install
npm test                      # token unit tests
npm run deploy:sepolia        # uses SEPOLIA_RPC_URL + PRIVATE_KEY from contracts/.env or ../.env
```

Addresses are written to `contracts/deployments/sepolia.json` and printed as `TOKEN_*_ADDRESS=` lines.

**2. Backend:** copy `backend/env.example` to `backend/.env` and fill it in: database, JWT secret, SMTP, `SEPOLIA_RPC_URL`, the token addresses, and `FACILITATOR_PRIVATE_KEY`. That key is the relayer wallet that settles payments and pays the gas, so it needs Sepolia ETH.

```bash
cd backend && pnpm install
pnpm prisma migrate deploy
pnpm dev                      # http://localhost:4000
```

Without `SMTP_HOST` (outside production) the verification link is printed to the API console.

**3. Frontend:** copy `env.example` to `.env.local`, then set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CHAIN_ID=11155111` and the `NEXT_PUBLIC_TOKEN_*_ADDRESS` values.

```bash
npm install && npm run dev     # http://localhost:3000
```

**Flow:** sign up → verify email → sign in → pick **Merchant** or **Customer**.
- **Merchant:** Request a payment, which shows a single-use QR code for one invoice.
- **Customer:** connect MetaMask (Sepolia), get test tokens from the faucet, then **Pay** (scan the QR, review the merchant and items, sign) or **Refund** (request a reversal; the 3% fee is non-refundable).

Customers sign an EIP-3009 authorisation only. They need no ETH, because the backend's facilitator submits the transfer on-chain.

**Local chain instead of Sepolia:** run `npx hardhat node` and `npx hardhat run scripts/deploy.ts --network localhost` in `contracts/`. Then set `CHAIN_ID=31337`, `SEPOLIA_RPC_URL=http://127.0.0.1:8545`, a Hardhat dev key as `FACILITATOR_PRIVATE_KEY`, and `NEXT_PUBLIC_CHAIN_ID=31337`. `backend/scripts/e2e-local.ts` runs the full flow (auth, wallet link, x402 payment, reversal) against that setup.
