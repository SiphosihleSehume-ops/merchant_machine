"use client";

import "viem/window"; // types window.ethereum
import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  formatUnits,
  parseUnits,
  type EIP1193Provider,
} from "viem";
import { hardhat, sepolia } from "viem/chains";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { CHAIN_ID, TOKENS, type TokenSymbol } from "./config";

export const chain = CHAIN_ID === hardhat.id ? hardhat : sepolia;
export const NETWORK = `eip155:${chain.id}` as const;

export class WalletError extends Error {}

export function getProvider(): EIP1193Provider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new WalletError("MetaMask not found. Install the MetaMask extension or open this page in the MetaMask app browser.");
  }
  return window.ethereum;
}

export const hasMetaMask = () => typeof window !== "undefined" && !!window.ethereum;

/** Switches MetaMask to our chain, adding it first if MetaMask doesn't know it. */
async function ensureChain(provider: EIP1193Provider) {
  const hexId = `0x${chain.id.toString(16)}` as const;
  const current = await provider.request({ method: "eth_chainId" });
  if (current?.toLowerCase() === hexId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (error: any) {
    if (error?.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hexId,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [...chain.rpcUrls.default.http],
        blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
      }],
    });
  }
}

export async function connectWallet(): Promise<`0x${string}`> {
  const provider = getProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new WalletError("No account selected in MetaMask.");
  await ensureChain(provider);
  return accounts[0];
}

/** Already-authorised account, without prompting. */
export async function currentAccount(): Promise<`0x${string}` | null> {
  if (!hasMetaMask()) return null;
  const accounts = await getProvider().request({ method: "eth_accounts" });
  return accounts?.[0] ?? null;
}

const publicClient = () => createPublicClient({ chain, transport: custom(getProvider()) });

async function walletClient(address: `0x${string}`) {
  const provider = getProvider();
  await ensureChain(provider);
  return createWalletClient({ account: address, chain, transport: custom(provider) });
}

export type Balance = { symbol: string; label: string; amount: string; raw: bigint; address?: `0x${string}` };

export async function getBalances(address: `0x${string}`): Promise<Balance[]> {
  const client = publicClient();
  const eth = await client.getBalance({ address });
  const tokens = await Promise.all(
    TOKENS.filter((t) => t.address).map(async (t) => {
      const raw = await client
        .readContract({ address: t.address!, abi: erc20Abi, functionName: "balanceOf", args: [address] })
        .catch(() => 0n);
      return { symbol: t.symbol, label: t.label, raw, amount: formatUnits(raw, t.decimals), address: t.address };
    }),
  );
  return [...tokens, { symbol: "ETH", label: "Gas", raw: eth, amount: formatUnits(eth, 18) }];
}

const faucetAbi = [{ type: "function", name: "faucet", inputs: [], outputs: [], stateMutability: "nonpayable" }] as const;

/** Testnet only: mints the token's faucet amount to the connected wallet (needs a little ETH for gas). */
export async function claimFaucet(address: `0x${string}`, symbol: TokenSymbol) {
  const token = TOKENS.find((t) => t.symbol === symbol);
  if (!token?.address) throw new WalletError(`${symbol} address is not configured`);
  const wc = await walletClient(address);
  const hash = await wc.writeContract({ address: token.address, abi: faucetAbi, functionName: "faucet" });
  await publicClient().waitForTransactionReceipt({ hash });
  return hash;
}

/** MUST match backend/src/services/customer.service.ts walletLinkMessage(). */
export function walletLinkMessage(userId: string, address: string, issuedAt: string) {
  return [
    "Merchant Machine: link this wallet to my account.",
    `Account: ${userId}`,
    `Wallet: ${address.toLowerCase()}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}

export async function signWalletLink(userId: string, address: `0x${string}`) {
  const issuedAt = new Date().toISOString();
  const wc = await walletClient(address);
  const signature = await wc.signMessage({ message: walletLinkMessage(userId, address, issuedAt) });
  return { address, issuedAt, signature };
}

/** MUST match backend/src/services/merchant.service.ts shopWalletMessage(). */
export function shopWalletMessage(userId: string, address: string, issuedAt: string) {
  return [
    "Merchant Machine: receive my shop payments at this wallet.",
    `Account: ${userId}`,
    `Wallet: ${address.toLowerCase()}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}

/** Merchant proves control of the payout wallet (signature only, no gas). */
export async function signShopWallet(userId: string, address: `0x${string}`) {
  const issuedAt = new Date().toISOString();
  const wc = await walletClient(address);
  const signature = await wc.signMessage({ message: shopWalletMessage(userId, address, issuedAt) });
  return { address, issuedAt, signature };
}

// ------------------------------------------------------------------
// x402
// ------------------------------------------------------------------

function httpClient(address: `0x${string}`, pick?: (reqs: PaymentRequirements[]) => PaymentRequirements) {
  const client = new x402Client(pick ? (_v, reqs) => pick(reqs) : undefined);
  client.register(
    NETWORK,
    new ExactEvmScheme(
      toClientEvmSigner(
        {
          address,
          signTypedData: async (msg) => (await walletClient(address)).signTypedData(msg as any),
        },
        publicClient(),
      ),
    ),
  );
  // Our tokens are not in x402's default asset table, so allow them explicitly
  client.setSpendControls({
    allowedAssets: TOKENS.filter((t) => t.address).map((t) => ({ network: NETWORK, asset: t.address! })),
  });
  return new x402HTTPClient(client);
}

/** Decodes the PAYMENT-REQUIRED header of a 402 response. */
export function readPaymentRequired(res: Response, body: unknown): PaymentRequired {
  return new x402HTTPClient(new x402Client()).getPaymentRequiredResponse((n) => res.headers.get(n), body);
}

/**
 * Signs an EIP-3009 authorization in MetaMask for the chosen token (no gas for the
 * customer) and retries the pay URL with it. Returns the settlement (tx hash).
 */
export async function payInvoice(
  payUrl: string,
  address: `0x${string}`,
  paymentRequired: PaymentRequired,
  asset: `0x${string}`,
) {
  const client = httpClient(address, (reqs) => {
    const match = reqs.find((r) => r.asset.toLowerCase() === asset.toLowerCase());
    if (!match) throw new WalletError("Selected token is not accepted for this invoice");
    return match;
  });

  const payload = await client.createPaymentPayload(paymentRequired);
  const res = await fetch(payUrl, {
    headers: { accept: "application/json", ...client.encodePaymentSignatureHeader(payload) },
  });
  const body = await res.json().catch(() => ({}));

  if (res.status !== 200) {
    throw new WalletError(body?.error && typeof body.error === "string" ? body.error : `Payment failed (${res.status})`);
  }
  const settlement = client.getPaymentSettleResponse((n) => res.headers.get(n));
  if (!settlement.success) {
    throw new WalletError(settlement.errorMessage || settlement.errorReason || "Settlement failed");
  }
  return { settlement, receipt: body?.data };
}

/**
 * Sends an ERC-20 token from the connected MetaMask account (the sender pays gas in ETH).
 * Returns once the transaction is mined.
 */
export async function sendToken(from: `0x${string}`, symbol: TokenSymbol, to: `0x${string}`, amount: string) {
  const token = TOKENS.find((t) => t.symbol === symbol);
  if (!token?.address) throw new WalletError(`${symbol} address is not configured`);
  const value = parseUnits(amount, token.decimals);
  if (value <= 0n) throw new WalletError("Enter an amount greater than 0");
  const wc = await walletClient(from);
  const hash = await wc.writeContract({ address: token.address, abi: erc20Abi, functionName: "transfer", args: [to, value] });
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new WalletError("Transfer failed on-chain");
  return hash;
}

export const shortAddress = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
