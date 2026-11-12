import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat, sepolia } from 'viem/chains';
import { x402Facilitator } from '@x402/core/facilitator';
import type { FacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { toFacilitatorEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/facilitator';
import { CHAIN_ID, RPC_URL, X402_NETWORK } from './x402.js';

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

function getFacilitator(): x402Facilitator {
  if (facilitator) return facilitator;

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

/** FacilitatorClient adapter so x402ResourceServer talks to the in-process facilitator. */
export const localFacilitatorClient: FacilitatorClient = {
  verify: (payload: PaymentPayload, requirements: PaymentRequirements) => getFacilitator().verify(payload, requirements),
  settle: (payload: PaymentPayload, requirements: PaymentRequirements) => getFacilitator().settle(payload, requirements),
  getSupported: async () => getFacilitator().getSupported() as any,
};
