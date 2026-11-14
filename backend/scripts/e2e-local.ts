// Local end-to-end test: auth -> role -> wallet link -> x402 payment on a local chain -> reversal.
// Prereqs: `npx hardhat node` + deploy (contracts/), a fresh Postgres with migrations applied,
// and the API running with CHAIN_ID=31337 and NO SMTP_HOST (verification links are read from the API log).
// Usage: npx tsx scripts/e2e-local.ts <path-to-api-log>

import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, erc20Abi, formatUnits } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { walletLinkMessage } from '../src/services/customer.service.js';

const API = (process.env.API_URL || `http://localhost:${process.env.PORT || 4100}/api/v1`).replace(/\/$/, '');
const LOG = process.argv[2];
const ZARK = (process.env.TOKEN_ZARK_ADDRESS || '0x5fbdb2315678afecb367f032d93f642f64180aa3').toLowerCase() as `0x${string}`;
const USDC = (process.env.TOKEN_USDC_ADDRESS || '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512').toLowerCase() as `0x${string}`;
// Fresh wallet each run with zero ETH: proves the customer pays gaslessly
const customerAcct = privateKeyToAccount(generatePrivateKey());
// Hardhat account 0 = token owner (deployer) and facilitator relayer
const ownerAcct = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const merchantWallet = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as const; // hardhat account 2
const pub = createPublicClient({ chain: hardhat, transport: http('http://127.0.0.1:8545') });
const wallet = createWalletClient({ account: customerAcct, chain: hardhat, transport: http('http://127.0.0.1:8545') });
const owner = createWalletClient({ account: ownerAcct, chain: hardhat, transport: http('http://127.0.0.1:8545') });

let pass = 0, fail = 0;
const check = (name: string, cond: unknown, extra: unknown = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`, cond ? '' : extra); };
async function call(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) as any };
}
const otpFor = (email: string) => {
  const lines = readFileSync(LOG, 'utf8').split('\n');
  const line = lines.findLast((l) => l.includes(`Verification OTP for ${email}:`));
  return line?.split(':').pop()?.trim() ?? '';
};
// Unique per run so the script can be re-run without resetting the database
const RUN = Date.now().toString(36);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signUp(email: string) {
  const reg = await call('POST', '/auth/register', { firstName: 'Test', lastName: 'User', email, password: 'password123' });
  check(`register ${email} -> 201`, reg.status === 201, reg);
  const early = await call('POST', '/auth/login', { email, password: 'password123' });
  check('login before verify -> 403 EMAIL_NOT_VERIFIED', early.status === 403 && early.json.code === 'EMAIL_NOT_VERIFIED', early);
  await sleep(200);
  const otp = reg.json?.data?.devOtp || otpFor(email);
  const badOtp = await call('POST', '/auth/verify-otp', { email, otp: '000000' });
  check('wrong OTP -> 400', badOtp.status === 400, badOtp);
  const v = await call('POST', '/auth/verify-otp', { email, otp });
  check('verify OTP -> 200 with session', v.status === 200 && typeof v.json.data.token === 'string', v);
  const again = await call('POST', '/auth/verify-otp', { email, otp });
  check('reuse OTP -> 400', again.status === 400, again);
  const bad = await call('POST', '/auth/login', { email, password: 'wrong-password' });
  check('wrong password -> 401', bad.status === 401, bad);
  const login = await call('POST', '/auth/login', { email, password: 'password123' });
  check('login -> 200, no role yet', login.status === 200 && login.json.data.user.role === null, login);
  return login.json.data.token as string;
}

// ---------- merchant ----------
const mTok0 = await signUp(`shop+${RUN}@example.com`);
const noRole = await call('POST', '/invoices', { items: [{ name: 'x', quantity: 1, unitPrice: 1 }] }, mTok0);
check('invoice without merchant role -> 403', noRole.status === 403, noRole);
const mNoName = await call('POST', '/auth/select-role', { role: 'MERCHANT' }, mTok0);
check('merchant first time without business name -> 400', mNoName.status === 400, mNoName);
const mSel = await call('POST', '/auth/select-role', { role: 'MERCHANT', businessName: 'Kasi Corner Shop', cryptoWallet: merchantWallet }, mTok0);
check('select MERCHANT -> token with role', mSel.status === 200 && mSel.json.data.user.role === 'MERCHANT', mSel);
const mTok = mSel.json.data.token;
const inv = await call('POST', '/invoices', { currency: 'ZAR', items: [{ name: 'Bread', quantity: 2, unitPrice: 18.5 }, { name: 'Milk', quantity: 1, unitPrice: 23 }] }, mTok);
check('merchant creates invoice (R60.00)', inv.status === 201 && Number(inv.json.data.totalAmount) === 60, inv);
const invoiceId = inv.json.data.id;

// ---------- customer ----------
const cTok0 = await signUp(`buyer+${RUN}@example.com`);
const cSel = await call('POST', '/auth/select-role', { role: 'CUSTOMER' }, cTok0);
check('select CUSTOMER', cSel.status === 200 && cSel.json.data.user.role === 'CUSTOMER', cSel);
const cTok = cSel.json.data.token;
const userId = cSel.json.data.user.id;
const custInv = await call('POST', '/invoices', { items: [{ name: 'x', quantity: 1, unitPrice: 1 }] }, cTok);
check('customer cannot create invoices -> 403', custInv.status === 403, custInv);

const issuedAt = new Date().toISOString();
const badSig = await wallet.signMessage({ message: walletLinkMessage('someone-else', customerAcct.address, issuedAt) });
const wBad = await call('PUT', '/customers/me/wallet', { address: customerAcct.address, issuedAt, signature: badSig }, cTok);
check('link wallet with wrong-message signature -> 400', wBad.status === 400, wBad);
const sig = await wallet.signMessage({ message: walletLinkMessage(userId, customerAcct.address, issuedAt) });
const w = await call('PUT', '/customers/me/wallet', { address: customerAcct.address, issuedAt, signature: sig }, cTok);
check('link wallet with valid signature', w.status === 200 && w.json.data.walletAddress === customerAcct.address.toLowerCase(), w);

// fund customer: owner mints 100 ZARK (customer holds no ETH at all)
const mintAbi = [{ type: 'function', name: 'mint', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }] as const;
await pub.waitForTransactionReceipt({ hash: await owner.writeContract({ address: ZARK, abi: mintAbi, functionName: 'mint', args: [customerAcct.address, 100_000000n] }) });
check('customer has 0 ETH', (await pub.getBalance({ address: customerAcct.address })) === 0n);
const bal = (a: `0x${string}`, who: `0x${string}`) => pub.readContract({ address: a, abi: erc20Abi, functionName: 'balanceOf', args: [who] });
const before = { cust: await bal(ZARK, customerAcct.address), merch: await bal(ZARK, merchantWallet) };

// ---------- x402 pay ----------
const challenge = await fetch(`${API}/x402/pay/${invoiceId}`, { headers: { accept: 'application/json' } });
const body = await challenge.json() as any;
check('402 challenge shows real merchant + items', challenge.status === 402 && body.invoice.merchant.name === 'Kasi Corner Shop' && body.invoice.items.length === 2, body);
check('two payment options: ZARK 60 / USDC 3.243244', body.payment.options.map((o: any) => `${o.symbol}:${o.amount}`).join(',') === 'ZARK:60000000,USDC:3243244', body.payment.options);

const client = new x402Client((_v, reqs) => reqs.find((r) => r.asset.toLowerCase() === ZARK)!);
client.register('eip155:31337', new ExactEvmScheme(toClientEvmSigner({ address: customerAcct.address, signTypedData: (m) => wallet.signTypedData(m as any) }, pub)));
client.setSpendControls({ allowedAssets: [{ network: 'eip155:31337', asset: ZARK }, { network: 'eip155:31337', asset: USDC }] });
const http402 = new x402HTTPClient(client);
const paymentRequired = http402.getPaymentRequiredResponse((n) => challenge.headers.get(n), body);
const payload = await http402.createPaymentPayload(paymentRequired);
const paid = await fetch(`${API}/x402/pay/${invoiceId}`, { headers: { accept: 'application/json', ...http402.encodePaymentSignatureHeader(payload) } });
const paidBody = await paid.json() as any;
check('paid request -> 200', paid.status === 200, paidBody);
const settle = http402.getPaymentSettleResponse((n) => paid.headers.get(n));
check('PAYMENT-RESPONSE has tx hash', settle.success && /^0x[0-9a-f]{64}$/.test(settle.transaction), settle);
const after = { cust: await bal(ZARK, customerAcct.address), merch: await bal(ZARK, merchantWallet) };
check('on-chain: customer -60 ZARK, merchant +60 ZARK', before.cust - after.cust === 60_000000n && after.merch - before.merch === 60_000000n, { before, after });

const replay = await fetch(`${API}/x402/pay/${invoiceId}`, { headers: { accept: 'application/json', ...http402.encodePaymentSignatureHeader(payload) } });
check('replay of paid invoice -> 409 (invoice PAID)', replay.status === 409, replay.status);

const feePct = Number(process.env.PLATFORM_FEE_PERCENT ?? '2.5');
const expFee = ((60 * feePct) / 100).toFixed(2);
const expNet = (60 - Number(expFee)).toFixed(2);
const expNetAtomic = BigInt(Math.round(Number(expNet) * 1_000_000));

await sleep(300);
const txs = await call('GET', '/transactions', undefined, cTok);
const t = txs.json.data[0];
check('customer history: SETTLED, ZARK, tx hash, linked', t?.status === 'SETTLED' && t.asset === 'ZARK' && t.txHash === settle.transaction, txs.json);
check(`history includes non-refundable service fee R${expFee}`, t?.serviceFee === expFee, t);
const invStatus = await call('GET', `/invoices/${invoiceId}`, undefined, mTok);
check('merchant invoice lookup shows PAID + asset', invStatus.json?.data?.status === 'PAID' && invStatus.json.data.payment?.asset === 'ZARK', invStatus.json);
const otherInv = await call('GET', `/invoices/${invoiceId}`, undefined, cTok);
check('customer cannot read merchant invoice -> 403', otherInv.status === 403, otherInv);
const mtxs = await call('GET', '/transactions', undefined, mTok);
check('merchant history sees the payment', mtxs.json.data[0]?.id === t?.id, mtxs.json);

// ---------- reversal ----------
const noAck = await call('POST', '/reversals', { transactionId: t.id }, cTok);
check('reversal without fee acknowledgement -> 400', noAck.status === 400, noAck);
const rev = await call('POST', '/reversals', { transactionId: t.id, reason: 'Wrong items', acknowledgeNonRefundableFee: true }, cTok);
check(`reversal requested: ${expNet} back, ${expFee} fee kept, PENDING_MERCHANT`, rev.status === 201 && rev.json.data.amount === expNet && rev.json.data.reversalFee === expFee && rev.json.data.status === 'PENDING_MERCHANT', rev);
const dup = await call('POST', '/reversals', { transactionId: t.id, acknowledgeNonRefundableFee: true }, cTok);
check('duplicate reversal -> 409', dup.status === 409, dup);
const mRev = await call('GET', '/reversals', undefined, mTok);
check('merchant sees reversal request', mRev.json.data.length === 1, mRev.json);

const cannotApprove = await call('PATCH', `/reversals/${rev.json.data.id}`, { action: 'APPROVE' }, cTok);
check('customer cannot approve reversal -> 403', cannotApprove.status === 403, cannotApprove);
const approved = await call('PATCH', `/reversals/${rev.json.data.id}`, { action: 'APPROVE' }, mTok);
check('merchant approves reversal -> COMPLETED with refundTxHash', approved.status === 200 && approved.json.data.status === 'COMPLETED' && /^0x[0-9a-f]{64}$/.test(approved.json.data.refundTxHash), approved);
const dupApprove = await call('PATCH', `/reversals/${rev.json.data.id}`, { action: 'APPROVE' }, mTok);
check('idempotent: second approve -> 409', dupApprove.status === 409, dupApprove);

const afterRefund = await bal(ZARK, customerAcct.address);
check(`on-chain refund: customer received +${expNet} ZARK`, afterRefund - after.cust === expNetAtomic, { after: after.cust, afterRefund });

const txsAfter = await call('GET', '/transactions', undefined, cTok);
check('transaction display status is REVERSED', txsAfter.json.data[0]?.status === 'REVERSED', txsAfter.json.data[0]);

const ledger = await call('GET', '/merchants/me/ledger', undefined, mTok);
check(`ledger net payable is 0.00 and platform fee is ${expFee}`, ledger.status === 200 && ledger.json.data.balances.merchantPayable === '0.00' && ledger.json.data.balances.platformFees === expFee, ledger.json);

const webhooks = await call('GET', '/merchants/me/webhooks', undefined, mTok);
check('webhooks recorded for payment.settled, reversal.requested, reversal.completed', webhooks.status === 200 && webhooks.json.data.length === 3, webhooks.json);

const kycBefore = await call('GET', '/customers/me', undefined, cTok);
check('customer starts at TIER_1_BASIC', kycBefore.status === 200 && kycBefore.json.data.tier === 'TIER_1_BASIC', kycBefore.json);
const kycAfter = await call('POST', '/customers/me/kyc', { fullName: 'Test Buyer', countryCode: 'ZA', popiaConsent: true }, cTok);
check('customer KYC upgrades to TIER_2_VERIFIED', kycAfter.status === 200 && kycAfter.json.data.tier === 'TIER_2_VERIFIED', kycAfter.json);

// ---------- merchant shop, balance, accounts, devices, and directPay receipt ----------
const shop = await call('GET', '/merchants/me/shop', undefined, mTok);
check('merchant shop details returned', shop.status === 200 && shop.json.data.name === 'Kasi Corner Shop', shop.json);
const mBal = await call('GET', '/merchants/me/balance', undefined, mTok);
check('merchant live on-chain ZARK balance returned', mBal.status === 200 && typeof mBal.json.data.balance === 'string', mBal.json);
const accts = await call('GET', '/merchants/me/accounts', undefined, mTok);
check('merchant accounts list includes main shop', accts.status === 200 && Array.isArray(accts.json.data.accounts) && accts.json.data.accounts.length >= 1, accts.json);

const devSerial = `POS-${RUN.toUpperCase()}`;
const devLink = await call('POST', '/devices', { name: 'Counter Terminal 1', serial: devSerial }, mTok);
check('merchant links POS device -> 201', devLink.status === 201 && devLink.json.data.serial === devSerial, devLink.json);
const devList = await call('GET', '/devices', undefined, mTok);
check('merchant lists linked POS devices', devList.status === 200 && devList.json.data.some((d: any) => d.serial === devSerial), devList.json);
const devDel = await call('DELETE', `/devices/${devLink.json.data.id}`, undefined, mTok);
check('merchant unlinks POS device -> 200', devDel.status === 200 && devDel.json.data.removed === true, devDel.json);

const inv2 = await call('POST', '/invoices', { currency: 'ZAR', items: [{ name: 'Airtime', quantity: 1, unitPrice: 40 }] }, mTok);
const dpReceipt = await call('GET', `/x402/invoice/${inv2.json.data.id}`);
check('directPay receipt returns invoice + platformFee + ZARK pay details', dpReceipt.status === 200 && dpReceipt.json.data.total === '40.00' && dpReceipt.json.data.pay.symbol === 'ZARK', dpReceipt.json);

if (dpReceipt.json?.data?.pay?.contract) {
  const payContract = dpReceipt.json.data.pay.contract as `0x${string}`;
  const invRef = dpReceipt.json.data.pay.invoiceRef as `0x${string}`;
  await pub.waitForTransactionReceipt({ hash: await owner.writeContract({ address: ZARK, abi: mintAbi, functionName: 'mint', args: [ownerAcct.address, 40_000000n] }) });
  await pub.waitForTransactionReceipt({ hash: await owner.writeContract({ address: ZARK, abi: erc20Abi, functionName: 'approve', args: [payContract, 40_000000n] }) });
  const payAbi = [{ type: 'function', name: 'pay', inputs: [{ name: 'token', type: 'address' }, { name: 'merchant', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'invoiceRef', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' }] as const;
  const mpTx = await owner.writeContract({ address: payContract, abi: payAbi, functionName: 'pay', args: [ZARK, merchantWallet, 40_000000n, invRef] });
  await pub.waitForTransactionReceipt({ hash: mpTx });
  const dpConfirm = await call('POST', `/x402/invoice/${inv2.json.data.id}/transfer`, { txHash: mpTx }, cTok);
  check('MerchantPayments contract payment confirmed -> 200', dpConfirm.status === 200 && dpConfirm.json.data.platformFeeAtomic === '1000000', dpConfirm.json);

  const cTxsWithWallet = await call('GET', `/transactions?wallet=${ownerAcct.address}`, undefined, cTok);
  const dpTx = cTxsWithWallet.json?.data?.find((x: any) => x.invoiceId === inv2.json.data.id);
  check('customer sees directPay transaction under /transactions?wallet=', Boolean(dpTx), cTxsWithWallet.json);
  if (dpTx) {
    const instantRev = await call('POST', '/reversals', {
      transactionId: dpTx.id,
      amount: 20,
      reason: 'Partial refund test',
      acknowledgeNonRefundableFee: true,
      walletAddress: ownerAcct.address,
      autoApprove: true,
    }, cTok);
    check('customer partial instant refund (R20.00) -> COMPLETED with refundTxHash', instantRev.status === 201 && instantRev.json.data.status === 'COMPLETED' && instantRev.json.data.amount === '20.00' && /^0x[0-9a-f]{64}$/.test(instantRev.json.data.refundTxHash), instantRev.json);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
