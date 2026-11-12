import { createWalletClient, erc20Abi, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat, sepolia } from 'viem/chains';
import { x402Facilitator } from '@x402/core/facilitator';
import type { FacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { toFacilitatorEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/facilitator';
import { CHAIN_ID, RPC_URL, X402_NETWORK } from './x402.js';

const mintAbi = [
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

/**
 * Self-hosted x402 facilitator, running in-process.
 *
 * The public x402.org facilitator only settles real USDC, so our own tokens are settled
 * here: a relayer wallet (FACILITATOR_PRIVATE_KEY, needs Sepolia ETH for gas) submits the
 * customer's signed EIP-3009 transferWithAuthorization. The customer pays no gas.
 *
 * Built lazily so the API (auth, invoices) still boots when payment env is missing.
 */
let facilitator: x402Facilitator | null = null;

function getRelayerClient() {
  const key = process.env.FACILITATOR_PRIVATE_KEY;
  if (!key || !RPC_URL) {
    throw new Error('Payments not configured: set FACILITATOR_PRIVATE_KEY and SEPOLIA_RPC_URL in backend/.env');
  }
  // Sepolia for real testing; 31337 = local `hardhat node` for offline dev
  const chain = CHAIN_ID === sepolia.id ? sepolia : CHAIN_ID === hardhat.id ? hardhat : null;
  if (!chain) {
    throw new Error(`Unsupported CHAIN_ID ${CHAIN_ID}: expected ${sepolia.id} (Sepolia) or ${hardhat.id} (local)`);
  }

  const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`);
  const client = createWalletClient({ account, chain, transport: http(RPC_URL) }).extend(publicActions);
  return { account, client };
}

function getFacilitator(): x402Facilitator {
  if (facilitator) return facilitator;

  const { account, client } = getRelayerClient();

  const signer = toFacilitatorEvmSigner({
    address: account.address,
    readContract: (args) => client.readContract(args as any),
    verifyTypedData: (args) => client.verifyTypedData(args as any),
    writeContract: (args) => client.writeContract(args as any),
    sendTransaction: (args) => client.sendTransaction(args as any),
    waitForTransactionReceipt: (args) => client.waitForTransactionReceipt(args as any),
    getCode: (args) => client.getCode(args),
  });

  facilitator = new x402Facilitator().register(X402_NETWORK, new ExactEvmScheme(signer));
  console.log(`[x402] in-process facilitator ready on ${X402_NETWORK}, relayer ${account.address}`);
  return facilitator;
}

/**
 * PDF Section 3.2: Executes a reversal as a new on-chain payment back to the customer
 * from the platform-controlled treasury/relayer wallet (never via `transferFrom`).
 *
 * Transfers from the treasury balance when funded; on testnet, if the treasury wallet is
 * the TestStablecoin owner and has insufficient token balance, it mints the refund amount.
 */
export async function sendTreasuryRefund(params: {
  tokenAddress: `0x${string}`;
  to: `0x${string}`;
  amountAtomic: bigint;
}): Promise<`0x${string}`> {
  const { account, client } = getRelayerClient();
  const balance = await client.readContract({
    address: params.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });

  const hash =
    balance >= params.amountAtomic
      ? await client.writeContract({
          address: params.tokenAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [params.to, params.amountAtomic],
        })
      : await client.writeContract({
          address: params.tokenAddress,
          abi: mintAbi,
          functionName: 'mint',
          args: [params.to, params.amountAtomic],
        });

  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`On-chain refund transaction reverted (${hash})`);
  }
  return hash;
}

export function isRelayerConfigured(): boolean {
  return Boolean(process.env.FACILITATOR_PRIVATE_KEY && RPC_URL);
}

/** FacilitatorClient adapter so x402ResourceServer talks to the in-process facilitator. */
export const localFacilitatorClient: FacilitatorClient = {
  verify: (payload: PaymentPayload, requirements: PaymentRequirements) => getFacilitator().verify(payload, requirements),
  settle: (payload: PaymentPayload, requirements: PaymentRequirements) => getFacilitator().settle(payload, requirements),
  getSupported: async () => getFacilitator().getSupported() as any,
};
