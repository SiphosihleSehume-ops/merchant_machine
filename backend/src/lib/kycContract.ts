import { createPublicClient, createWalletClient, getAddress, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat, sepolia } from 'viem/chains';
import { CHAIN_ID, EXPLORER_TX_URL, HttpError, RPC_URL } from './x402.js';

/** Minimal ABI of contracts/contracts/KYCVerification.sol */
const abi = parseAbi([
  'function owner() view returns (address)',
  'function verify(address wallet)',
  'function revoke(address wallet)',
  'function isVerified(address wallet) view returns (bool verified, uint256 verifiedAt)',
]);

const chain = CHAIN_ID === hardhat.id ? hardhat : sepolia;
const contractAddress = () => {
  const a = process.env.KYC_CONTRACT_ADDRESS;
  return a && /^0x[a-fA-F0-9]{40}$/.test(a) ? (a as `0x${string}`) : null;
};

export const kycContractConfigured = () => !!contractAddress() && !!RPC_URL;

const publicClient = () => createPublicClient({ chain, transport: http(RPC_URL) });

/** Public on-chain status (what other applications see). */
export async function readOnChainStatus(wallet: string) {
  const address = contractAddress();
  if (!address || !RPC_URL) return null;
  try {
    const [verified, verifiedAt] = await publicClient().readContract({
      address,
      abi,
      functionName: 'isVerified',
      args: [getAddress(wallet)],
    });
    return { verified, verifiedAt: verifiedAt > 0n ? new Date(Number(verifiedAt) * 1000).toISOString() : null, contract: address };
  } catch {
    return null;
  }
}

/** Verifier approval: records the wallet on the KYCVerification contract. Returns the tx hash. */
/**
 * Sends KYCVerification.verify(wallet) and returns as soon as the transaction is broadcast
 * (does not wait for it to be mined). Use txStatus() to follow it.
 */
export async function sendVerifyTx(wallet: string): Promise<`0x${string}`> {
  const address = contractAddress();
  const key = process.env.KYC_VERIFIER_PRIVATE_KEY;
  if (!address || !key || !RPC_URL) {
    throw new HttpError(503, 'KYC contract not configured: set KYC_CONTRACT_ADDRESS, KYC_VERIFIER_PRIVATE_KEY and SEPOLIA_RPC_URL', 'KYC_CHAIN_NOT_CONFIGURED');
  }
  const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`);
  const owner = await publicClient().readContract({ address, abi, functionName: 'owner' });
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new HttpError(503, `KYC_VERIFIER_PRIVATE_KEY (${account.address}) is not the contract owner (${owner})`, 'KYC_NOT_OWNER');
  }
  const wc = createWalletClient({ account, chain, transport: http(RPC_URL) });
  return wc.writeContract({ address, abi, functionName: 'verify', args: [getAddress(wallet)] });
}

/** Current state of a transaction without waiting: mined OK, reverted, or still pending/unknown. */
export async function txStatus(hash: `0x${string}`): Promise<'success' | 'reverted' | 'pending'> {
  try {
    const receipt = await publicClient().getTransactionReceipt({ hash });
    return receipt.status === 'success' ? 'success' : 'reverted';
  } catch {
    return 'pending'; // not mined yet (or RPC hiccup): check again later
  }
}

/** Waits (in the background) for a transaction to be mined. */
export async function waitForTx(hash: `0x${string}`, timeoutMs = 10 * 60_000): Promise<'success' | 'reverted' | 'pending'> {
  try {
    const receipt = await publicClient().waitForTransactionReceipt({ hash, timeout: timeoutMs });
    return receipt.status === 'success' ? 'success' : 'reverted';
  } catch {
    return 'pending';
  }
}

export async function verifyOnChain(wallet: string): Promise<{ txHash: `0x${string}`; explorerUrl: string }> {
  const address = contractAddress();
  const key = process.env.KYC_VERIFIER_PRIVATE_KEY;
  if (!address || !key || !RPC_URL) {
    throw new HttpError(503, 'KYC contract not configured: set KYC_CONTRACT_ADDRESS, KYC_VERIFIER_PRIVATE_KEY and SEPOLIA_RPC_URL', 'KYC_CHAIN_NOT_CONFIGURED');
  }
  const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`);
  const pub = publicClient();

  const owner = await pub.readContract({ address, abi, functionName: 'owner' });
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new HttpError(503, `KYC_VERIFIER_PRIVATE_KEY (${account.address}) is not the contract owner (${owner})`, 'KYC_NOT_OWNER');
  }

  const wc = createWalletClient({ account, chain, transport: http(RPC_URL) });
  const txHash = await wc.writeContract({ address, abi, functionName: 'verify', args: [getAddress(wallet)] });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
  if (receipt.status !== 'success') {
    throw new HttpError(502, `On-chain verification failed (tx ${txHash})`, 'KYC_TX_FAILED');
  }
  return { txHash, explorerUrl: `${EXPLORER_TX_URL}${txHash}` };
}
