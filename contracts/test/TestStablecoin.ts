import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, parseSignature, toHex, type Address, type Hex } from "viem";
import { ONE, TOKENS } from "../scripts/tokens.js";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();
const [owner, alice, merchant, relayer] = await viem.getWalletClients();
const chainId = await publicClient.getChainId();

const USDC = TOKENS.find((t) => t.key === "USDC")!;

async function deployUsdc() {
  return viem.deployContract("TestStablecoin", [
    USDC.name,
    USDC.symbol,
    USDC.version,
    USDC.faucet * ONE,
    owner.account.address,
  ]);
}

type Token = Awaited<ReturnType<typeof deployUsdc>>;

const transferTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

let nonceCounter = 0;
async function signTransfer(token: Token, opts: { from?: typeof alice; to: Address; value: bigint; validBefore?: bigint; validAfter?: bigint }) {
  const signer = opts.from ?? alice;
  const now = BigInt(await networkHelpers.time.latest());
  const message = {
    from: signer.account.address,
    to: opts.to,
    value: opts.value,
    validAfter: opts.validAfter ?? 0n,
    validBefore: opts.validBefore ?? now + 3600n,
    nonce: keccak256(toHex(`nonce-${nonceCounter++}`)) as Hex,
  };
  const signature = await signer.signTypedData({
    domain: { name: USDC.name, version: USDC.version, chainId, verifyingContract: token.address },
    types: transferTypes,
    primaryType: "TransferWithAuthorization",
    message,
  });
  return { message, signature };
}

function args(m: Awaited<ReturnType<typeof signTransfer>>["message"]) {
  return [m.from, m.to, m.value, m.validAfter, m.validBefore, m.nonce] as const;
}

describe("TestStablecoin", () => {
  it("exposes USDC-like metadata matching its EIP-712 domain", async () => {
    const token = await deployUsdc();
    assert.equal(await token.read.name(), "USD Coin");
    assert.equal(await token.read.symbol(), "USDC");
    assert.equal(await token.read.decimals(), 6);
    assert.equal(await token.read.version(), "2");
    const [, domainName, domainVersion, domainChainId, verifyingContract] = await token.read.eip712Domain();
    assert.equal(domainName, "USD Coin");
    assert.equal(domainVersion, "2");
    assert.equal(domainChainId, BigInt(chainId));
    assert.equal(verifyingContract.toLowerCase(), token.address.toLowerCase());
  });

  it("only lets the owner mint", async () => {
    const token = await deployUsdc();
    await token.write.mint([alice.account.address, 5n * ONE]);
    assert.equal(await token.read.balanceOf([alice.account.address]), 5n * ONE);
    await viem.assertions.revertWithCustomErrorWithArgs(
      token.write.mint([alice.account.address, 1n], { account: alice.account }),
      token,
      "OwnableUnauthorizedAccount",
      [alice.account.address],
    );
  });

  it("faucet mints once per cooldown", async () => {
    const token = await deployUsdc();
    await token.write.faucet({ account: alice.account });
    assert.equal(await token.read.balanceOf([alice.account.address]), USDC.faucet * ONE);
    await viem.assertions.revertWithCustomError(token.write.faucet({ account: alice.account }), token, "FaucetCooldown");
    await networkHelpers.time.increase(24 * 60 * 60);
    await token.write.faucet({ account: alice.account });
    assert.equal(await token.read.balanceOf([alice.account.address]), 2n * USDC.faucet * ONE);
  });

  it("relayer can submit a signed transferWithAuthorization (v,r,s)", async () => {
    const token = await deployUsdc();
    await token.write.mint([alice.account.address, 100n * ONE]);
    const { message, signature } = await signTransfer(token, { to: merchant.account.address, value: 42n * ONE });
    const { v, r, s } = parseSignature(signature);

    await token.write.transferWithAuthorization([...args(message), Number(v), r, s], { account: relayer.account });

    assert.equal(await token.read.balanceOf([merchant.account.address]), 42n * ONE);
    assert.equal(await token.read.authorizationState([alice.account.address, message.nonce]), true);
  });

  it("accepts the bytes-signature overload used by x402 facilitators", async () => {
    const token = await deployUsdc();
    await token.write.mint([alice.account.address, 10n * ONE]);
    const { message, signature } = await signTransfer(token, { to: merchant.account.address, value: 3n * ONE });
    await token.write.transferWithAuthorization([...args(message), signature], { account: relayer.account });
    assert.equal(await token.read.balanceOf([merchant.account.address]), 3n * ONE);
  });

  it("rejects replayed, expired, early and forged authorizations", async () => {
    const token = await deployUsdc();
    await token.write.mint([alice.account.address, 100n * ONE]);

    const ok = await signTransfer(token, { to: merchant.account.address, value: 1n * ONE });
    await token.write.transferWithAuthorization([...args(ok.message), ok.signature], { account: relayer.account });
    await viem.assertions.revertWithCustomError(
      token.write.transferWithAuthorization([...args(ok.message), ok.signature], { account: relayer.account }),
      token,
      "AuthorizationAlreadyUsed",
    );

    const now = BigInt(await networkHelpers.time.latest());
    const expired = await signTransfer(token, { to: merchant.account.address, value: 1n, validBefore: now });
    await viem.assertions.revertWithCustomError(
      token.write.transferWithAuthorization([...args(expired.message), expired.signature], { account: relayer.account }),
      token,
      "AuthorizationExpired",
    );

    const early = await signTransfer(token, { to: merchant.account.address, value: 1n, validAfter: now + 1000n });
    await viem.assertions.revertWithCustomError(
      token.write.transferWithAuthorization([...args(early.message), early.signature], { account: relayer.account }),
      token,
      "AuthorizationNotYetValid",
    );

    // Signed by merchant but claims to be from alice
    const forged = await signTransfer(token, { from: merchant, to: relayer.account.address, value: 1n });
    const forgedArgs = [alice.account.address, ...args(forged.message).slice(1)] as unknown as ReturnType<typeof args>;
    await viem.assertions.revertWithCustomError(
      token.write.transferWithAuthorization([...forgedArgs, forged.signature], { account: relayer.account }),
      token,
      "InvalidSignature",
    );
  });

  it("supports EIP-2612 permit under the version-2 domain", async () => {
    const token = await deployUsdc();
    const now = BigInt(await networkHelpers.time.latest());
    const signature = await alice.signTypedData({
      domain: { name: USDC.name, version: USDC.version, chainId, verifyingContract: token.address },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: alice.account.address, spender: relayer.account.address, value: 7n, nonce: 0n, deadline: now + 600n },
    });
    const { v, r, s } = parseSignature(signature);
    await token.write.permit([alice.account.address, relayer.account.address, 7n, now + 600n, Number(v), r, s]);
    assert.equal(await token.read.allowance([alice.account.address, relayer.account.address]), 7n);
    assert.equal(await token.read.nonces([alice.account.address]), 1n);
  });

  it("deploys all three tokens with distinct metadata", async () => {
    for (const t of TOKENS) {
      const token = await viem.deployContract("TestStablecoin", [t.name, t.symbol, t.version, t.faucet * ONE, owner.account.address]);
      assert.equal(await token.read.symbol(), t.symbol);
      assert.equal(await token.read.version(), t.version);
      assert.equal(await token.read.faucetAmount(), t.faucet * ONE);
    }
  });
});
