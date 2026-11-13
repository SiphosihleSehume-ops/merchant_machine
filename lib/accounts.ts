import { api } from "./api";

export type BusinessAccount = {
  id: string; // "main" = the shop itself
  kind: "MAIN" | "BRANCH";
  name: string;
  category: string | null;
  walletAddress: string | null;
  verified: boolean;
  explorerUrl: string | null;
  balance: string; // ZARK, decimal string
};

export type AccountsResponse = { kycApproved: boolean; accounts: BusinessAccount[] };

export const loadAccounts = () => api<AccountsResponse>("/merchants/me/accounts");

/** Accounts money can move between: verified and with a wallet. */
export const transferable = (list: BusinessAccount[]) => list.filter((a) => a.verified && a.walletAddress);

export const zark = (v: string | number) =>
  `ZARK ${Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
