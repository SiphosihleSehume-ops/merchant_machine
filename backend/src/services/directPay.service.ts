import { Prisma } from '@prisma/client';
import { createPublicClient, decodeEventLog, erc20Abi, getAddress, http } from 'viem';
import { hardhat, sepolia } from 'viem/chains';
import { prisma } from '../lib/prisma.js';
import { CHAIN_ID, EXPLORER_TX_URL, HttpError, RPC_URL, TOKENS } from '../lib/x402.js';
import { X402Service } from './x402.service.js';

const chain = CHAIN_ID === hardhat.id ? hardhat : sepolia;
const client = () => createPublicClient({ chain, transport: http(RPC_URL) });

/**
 * Direct ZARK payment for an invoice: the customer sends a normal ERC-20 transfer from
 * MetaMask (works with any ERC-20, no EIP-3009 needed), then submits the tx hash. The
 * backend only marks the invoice paid after verifying ON-CHAIN that the transaction:
 *   - succeeded, on the configured ZARK token
 *   - transferred at least the invoice total to the merchant's registered wallet
 *   - has not already been used for another payment
 */
export class DirectPayService {
  /** Public receipt the customer sees before confirming. */
  static async receipt(invoiceId: string) {
    const quote = await X402Service.getPayableQuote(invoiceId);
    const zark = quote.options.find((o) => o.symbol === 'ZARK');
    if (!zark) throw new HttpError(503, 'ZARK payments are not configured (TOKEN_ZARK_ADDRESS)');
    return {
      invoiceId: quote.invoiceId,
      merchant: { name: quote.merchantName, category: quote.merchantCategory ?? null, wallet: quote.payTo },
      items: quote.items,
      subtotal: quote.subtotal,
      total: quote.totalAmount,
      currency: quote.currency,
      expiresAt: quote.expiresAt,
      pay: { symbol: 'ZARK', token: zark.asset, amountAtomic: zark.amountAtomic, decimals: zark.decimals, chainId: CHAIN_ID },
    };
  }

  static async confirm(invoiceId: string, txHash: `0x${string}`) {
    const used = await prisma.settlement.findFirst({ where: { txHash } });
    if (used) throw new HttpError(409, 'This transaction was already used for a payment', 'TX_ALREADY_USED');

    // Validates the invoice is still payable and gives the exact amount + merchant wallet
    const quote = await X402Service.getPayableQuote(invoiceId);
    const zark = quote.options.find((o) => o.symbol === 'ZARK');
    const token = TOKENS.ZARK.address;
    if (!zark || !token) throw new HttpError(503, 'ZARK payments are not configured');

    let receipt;
    try {
      receipt = await client().waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
    } catch {
      throw new HttpError(504, 'Transaction not confirmed yet. Wait a moment and try again.', 'TX_PENDING');
    }
    if (receipt.status !== 'success') throw new HttpError(400, 'That transaction failed on-chain', 'TX_FAILED');

    const merchantWallet = getAddress(quote.payTo);
    const required = BigInt(zark.amountAtomic);
    const transfer = receipt.logs
      .filter((l) => l.address.toLowerCase() === token.toLowerCase())
      .map((l) => {
        try {
          return decodeEventLog({ abi: erc20Abi, data: l.data, topics: l.topics });
        } catch {
          return null;
        }
      })
      .find((e) => e?.eventName === 'Transfer' && getAddress(e.args.to) === merchantWallet);

    if (!transfer || transfer.eventName !== 'Transfer') {
      throw new HttpError(400, "That transaction didn't send ZARK to this shop's wallet", 'TX_WRONG_RECIPIENT');
    }
    if (transfer.args.value < required) {
      throw new HttpError(400, 'The amount sent is less than the invoice total', 'TX_UNDERPAID');
    }

    if (!(await X402Service.claimForSettlement(quote))) {
      throw new HttpError(409, 'This invoice is already being paid', 'INVOICE_BUSY');
    }
    try {
      await X402Service.settlePayment(invoiceId, txHash, {
        fxSnapshot: new Prisma.Decimal(1), // ZARK is 1:1 with ZAR
        asset: 'ZARK',
        payer: transfer.args.from,
      });
    } catch (error) {
      await X402Service.markSettlementFailed(invoiceId).catch(() => undefined);
      throw error;
    }

    return {
      invoiceId,
      merchantName: quote.merchantName,
      total: quote.totalAmount,
      currency: quote.currency,
      paid: { symbol: 'ZARK', amountAtomic: transfer.args.value.toString(), decimals: zark.decimals },
      payer: transfer.args.from,
      txHash,
      explorerUrl: `${EXPLORER_TX_URL}${txHash}`,
    };
  }
}
