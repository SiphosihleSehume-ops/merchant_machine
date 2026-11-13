import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

const { viem, networkHelpers } = await network.create();
const [owner, merchant, stranger, newOwner] = await viem.getWalletClients();

describe("KYCVerification", () => {
  it("sets the deployer as owner and starts unverified", async () => {
    const kyc = await viem.deployContract("KYCVerification");
    assert.equal((await kyc.read.owner()).toLowerCase(), owner.account.address.toLowerCase());
    assert.deepEqual(await kyc.read.isVerified([merchant.account.address]), [false, 0n]);
  });

  it("owner verifies a wallet with a timestamp and emits an event", async () => {
    const kyc = await viem.deployContract("KYCVerification");
    await viem.assertions.emit(kyc.write.verify([merchant.account.address]), kyc, "WalletVerified");
    const [verified, at] = await kyc.read.isVerified([merchant.account.address]);
    assert.equal(verified, true);
    assert.equal(at, BigInt(await networkHelpers.time.latest()));
  });

  it("only the owner can verify, revoke or transfer ownership", async () => {
    const kyc = await viem.deployContract("KYCVerification");
    await viem.assertions.revertWith(
      kyc.write.verify([merchant.account.address], { account: stranger.account }),
      "Not authorized",
    );
    await kyc.write.verify([merchant.account.address]);
    await viem.assertions.revertWith(
      kyc.write.revoke([merchant.account.address], { account: stranger.account }),
      "Not authorized",
    );
    await viem.assertions.revertWith(
      kyc.write.transferOwnership([stranger.account.address], { account: stranger.account }),
      "Not authorized",
    );
  });

  it("revokes a verification", async () => {
    const kyc = await viem.deployContract("KYCVerification");
    await kyc.write.verify([merchant.account.address]);
    await kyc.write.revoke([merchant.account.address]);
    assert.deepEqual(await kyc.read.isVerified([merchant.account.address]), [false, 0n]);
    await viem.assertions.revertWith(kyc.write.revoke([merchant.account.address]), "Not verified");
  });

  it("rejects the zero address and hands over ownership", async () => {
    const kyc = await viem.deployContract("KYCVerification");
    await viem.assertions.revertWith(kyc.write.verify(["0x0000000000000000000000000000000000000000"]), "Invalid wallet");
    await kyc.write.transferOwnership([newOwner.account.address]);
    await kyc.write.verify([merchant.account.address], { account: newOwner.account });
    assert.equal((await kyc.read.isVerified([merchant.account.address]))[0], true);
  });
});
