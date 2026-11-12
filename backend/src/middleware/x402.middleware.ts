import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import type { PaymentOption } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { X402Service } from '../services/x402.service.js';
import { localFacilitatorClient } from '../lib/facilitator.js';
import {
  HttpError,
  PAYMENT_TOKENS,
  TokenSymbol,
  X402_NETWORK,
  currentQuote,
  quoteContext,
  tokenByAddress,
} from '../lib/x402.js';

/**
 * Step 1: load the invoice and reject anything not payable (404/409/410/422) before
 * any x402 work happens. The quote is then exposed to the rest of the request
 * (dynamic price/payTo, handler, settle hooks) via AsyncLocalStorage.
 */
export async function loadPayableInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    const quote = await X402Service.getPayableQuote(req.params.invoiceId as string);
    quoteContext.run(quote, next);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to load invoice' });
  }
}

function optionFor(symbol: TokenSymbol) {
  const option = currentQuote().options.find((o) => o.symbol === symbol);
  if (!option) throw new Error(`${symbol} is not configured`);
  return option;
}

// Step 2: real x402 verification + settlement via the self-hosted facilitator.
const resourceServer = new x402ResourceServer(localFacilitatorClient)
  .register(X402_NETWORK, new ExactEvmScheme())
  .onAfterSettle(async ({ result, requirements }) => {
    const quote = currentQuote();
    const option = quote.options.find((o) => o.asset.toLowerCase() === requirements.asset.toLowerCase());
    try {
      await X402Service.settlePayment(quote.invoiceId, result.transaction, {
        fxSnapshot: option ? new Prisma.Decimal(option.zarPerToken) : undefined,
        asset: tokenByAddress(requirements.asset)?.symbol,
        payer: result.payer,
      });
    } catch (error) {
      // Funds have moved on-chain at this point, so we must not fail the customer's
      // request. Log loudly for reconciliation against the tx hash.
      console.error(
        `[x402] RECONCILE: settled on-chain but ledger write failed for invoice ${quote.invoiceId} tx ${result.transaction}`,
        error,
      );
    }
  })
  .onSettleFailure(async ({ error }) => {
    const quote = currentQuote();
    console.error(`[x402] settlement failed for invoice ${quote.invoiceId}`, error);
    await X402Service.markSettlementFailed(quote.invoiceId);
  });

// One accepted payment option per payment token (ZARK 1:1, USDC via FX rate).
// Price and payTo are resolved per request from the invoice quote.
const accepts: PaymentOption[] = PAYMENT_TOKENS.map((symbol) => ({
  scheme: 'exact',
  network: X402_NETWORK,
  payTo: () => currentQuote().payTo,
  price: () => {
    const option = optionFor(symbol);
    return {
      asset: option.asset,
      amount: option.amountAtomic,
      // EIP-712 domain of the token, needed by EIP-3009 signers
      extra: { name: option.eip712.name, version: option.eip712.version },
    };
  },
  maxTimeoutSeconds: 300,
}));

export const x402InvoicePayment = paymentMiddleware(
  {
    // Path is relative to the router mount point (/api/v1/x402)
    'GET /pay/:invoiceId': {
      accepts,
      description: 'Merchant Machine invoice payment',
      mimeType: 'application/json',
      // Body of the 402 for API clients: the real merchant identity and invoice so the
      // customer can check it before signing (defeats fake-QR stickers).
      unpaidResponseBody: () => {
        const q = currentQuote();
        return {
          contentType: 'application/json',
          body: {
            error: 'Payment Required',
            invoice: {
              id: q.invoiceId,
              merchant: { name: q.merchantName, wallet: q.payTo },
              items: q.items,
              subtotal: q.subtotal,
              total: q.totalAmount,
              currency: q.currency,
              merchantFeePercentage: q.feePercentage,
              expiresAt: q.expiresAt.toISOString(),
            },
            payment: {
              network: X402_NETWORK,
              payTo: q.payTo,
              fxMode: 'demo',
              options: q.options.map((o) => ({
                symbol: o.symbol,
                asset: o.asset,
                amount: o.amountAtomic,
                zarPerToken: o.zarPerToken,
              })),
            },
          },
        };
      },
    },
  },
  resourceServer,
);

/**
 * Step 3 (runs only after the payment signature verified): claim the invoice so a
 * second concurrent payer is rejected. Returning >= 400 makes the x402 middleware
 * cancel settlement, so the second payer is never charged.
 */
export async function claimInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    const claimed = await X402Service.claimForSettlement(currentQuote());
    if (!claimed) {
      return res.status(409).json({ success: false, error: 'Invoice payment already in progress' });
    }
    next();
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to claim invoice' });
  }
}
