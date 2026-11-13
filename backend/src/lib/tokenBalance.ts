import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from 'viem';
import { hardhat, sepolia } from 'viem/chains';
import { CHAIN_ID, RPC_URL, TOKENS } from './x402.js';

const chain = CHAIN_ID === hardhat.id ? hardhat : sepolia;
let client: ReturnType<typeof createPublicClient> | null = null;
const publicClient = () => (client ??= createPublicClient({ chain, transport: http(RPC_URL) }));

/** Token decimals are read on-chain once (works for 6- and 18-decimal tokens). */
const decimalsCache = new Map<string, number>();
async function decimalsOf(token: `0x${string}`) {
  const key = token.toLowerCase();
  if (!decimalsCache.has(key)) {
    decimalsCache.set(key, Number(await publicClient().readContract({ address: token, abi: erc20Abi, functionName: 'decimals' })));
  }
  return decimalsCache.get(key)!;
}

/**
 * Live ZARK balance of a wallet. Never throws: a shop with no wallet, an unconfigured
 * token or an unreachable RPC simply shows 0 with a reason.
 */
export async function zarkBalanceOf(wallet: string | null) {
  const token = TOKENS.ZARK.address;
  const base = { symbol: 'ZARK' as const, chainId: CHAIN_ID, tokenAddress: token ?? null, wallet };
  if (!wallet) return { ...base, balance: '0', reason: 'NO_WALLET' as const };
  if (!token || !RPC_URL) return { ...base, balance: '0', reason: 'NOT_CONFIGURED' as const };
  try {
    const [raw, decimals] = await Promise.all([
      publicClient().readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [getAddress(wallet)] }),
      decimalsOf(token),
    ]);
    return { ...base, balance: formatUnits(raw, decimals), decimals, reason: null };
  } catch (error) {
    console.warn('[balance] could not read ZARK balance', (error as Error).message?.split('\n')[0]);
    return { ...base, balance: '0', reason: 'UNAVAILABLE' as const };
  }
}
