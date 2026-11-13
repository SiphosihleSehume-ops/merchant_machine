import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, maxUint256, parseUnits, toHex } from "viem";

const { viem } = await network.create();
const [owner, customer, merchant, treasury, stranger] = await viem.getWalletClients();
const ref = keccak256(toHex("invoice-123"));

async function setup(feeBps = 250) {
  // 18-decimal plain ERC-20, like the team's ZARK
  const token = await viem.deployContract("PlainToken", ["ZARK", "ZARK"]);
  const payments = await viem.deployContract("MerchantPayments", [treasury.account.address, feeBps]);
  await token.write.mint([customer.account.address, parseUnits("1000", 18)]);
  return { token, payments };
}

describe("MerchantPayments", () => {
  it("splits a payment: 97.5% to the merchant, 2.5% to the treasury", async () => {
    const { token, payments } = await setup();
    await token.write.approve([payments.address, maxUint256], { account: customer.account });

    const amount = parseUnits("100", 18);
    await viem.assertions.emitWithArgs(
      payments.write.pay([token.address, merchant.account.address, amount, ref], { account: customer.account }),
      payments,
      "PaymentMade",
      [ref, customer.account.address, merchant.account.address, token.address, amount, parseUnits("2.5", 18)],
    );

    assert.equal(await token.read.balanceOf([merchant.account.address]), parseUnits("97.5", 18));
    assert.equal(await token.read.balanceOf([treasury.account.address]), parseUnits("2.5", 18));
    assert.equal(await token.read.balanceOf([customer.account.address]), parseUnits("900", 18));
  });

  it("rounds the fee down so the merchant is never short-changed", async () => {
    const { token, payments } = await setup();
    await token.write.approve([payments.address, maxUint256], { account: customer.account });
    await payments.write.pay([token.address, merchant.account.address, 39n, ref], { account: customer.account });
    // 39 * 250 / 10000 = 0.975 -> 0
    assert.equal(await token.read.balanceOf([merchant.account.address]), 39n);
    assert.equal(await token.read.balanceOf([treasury.account.address]), 0n);
  });

  it("only pulls from the caller: an approval can't be spent by someone else", async () => {
    const { token, payments } = await setup();
    await token.write.approve([payments.address, maxUint256], { account: customer.account });
    // stranger has no tokens and pay() always uses msg.sender as the source
    await assert.rejects(
      payments.write.pay([token.address, stranger.account.address, parseUnits("10", 18), ref], { account: stranger.account }),
    );
    assert.equal(await token.read.balanceOf([customer.account.address]), parseUnits("1000", 18));
  });

  it("rejects payments without approval, zero amounts and a zero merchant", async () => {
    const { token, payments } = await setup();
    await assert.rejects(payments.write.pay([token.address, merchant.account.address, 1n, ref], { account: customer.account }));
    await token.write.approve([payments.address, maxUint256], { account: customer.account });
    await viem.assertions.revertWith(
      payments.write.pay([token.address, merchant.account.address, 0n, ref], { account: customer.account }),
      "Amount is zero",
    );
    await viem.assertions.revertWith(
      payments.write.pay([token.address, "0x0000000000000000000000000000000000000000", 1n, ref], { account: customer.account }),
      "Invalid merchant",
    );
  });

  it("owner-only admin with a 10% fee cap", async () => {
    const { payments } = await setup();
    await viem.assertions.revertWith(payments.write.setFeeBps([100], { account: stranger.account }), "Not authorized");
    await viem.assertions.revertWith(payments.write.setFeeBps([1001]), "Fee too high");
    await payments.write.setFeeBps([300]);
    assert.equal(await payments.read.feeBps(), 300);
    await viem.assertions.revertWith(payments.write.setTreasury([stranger.account.address], { account: stranger.account }), "Not authorized");
    await payments.write.setTreasury([stranger.account.address]);
    assert.equal((await payments.read.treasury()).toLowerCase(), stranger.account.address.toLowerCase());
    await assert.rejects(viem.deployContract("MerchantPayments", [treasury.account.address, 1001]));
    assert.equal((await payments.read.owner()).toLowerCase(), owner.account.address.toLowerCase());
  });
});
