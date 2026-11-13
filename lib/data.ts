// Placeholder data. Replace with real API calls when the back end is ready.

export const merchant = {
  name: "Kasi Corner Shop",
  cartCount: 0,
  shopCode: "RMT6VM",
  profileStep: 4,
  profileSteps: 7,
  rewardsLevel: 1,
  rewardsBalance: 45.02,
};

export const formatRand = (n: number) =>
  "R" +
  n
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Account balances are held in ZARK (1 ZARK = R1). */
export const ACCOUNT_CURRENCY = "ZARK";

export const formatZark = (n: number) =>
  `${ACCOUNT_CURRENCY} ` +
  n
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export type Supplier = { id: string; name: string; km: number };

export const suppliers: Supplier[] = [
  { id: "s1", name: "Albany Foods", km: 18 },
  { id: "s2", name: "Allied Wholesale (Pty) Ltd", km: 9 },
  { id: "s3", name: "Baobab Tobacco Distributors", km: 22 },
  { id: "s4", name: "Botha Mills", km: 31 },
  { id: "s5", name: "Brightway Brands (Pty) Ltd", km: 14 },
  { id: "s6", name: "Bryn Beverages", km: 7 },
  { id: "s7", name: "Eastgate Foods (Pty) Ltd", km: 4 },
  { id: "s8", name: "Zulu & Zondi Foods (Pty) Ltd", km: 4 },
  { id: "s9", name: "Galaxy Foods Industry", km: 5 },
  { id: "s10", name: "Rooibos Snack Co.", km: 5 },
  { id: "s11", name: "Golden Fresh Biscuits", km: 6 },
  { id: "s12", name: "Golden Fry", km: 12 },
  { id: "s13", name: "Il Mulino Bakeries", km: 15 },
];

export const topUps = [
  { id: "airtime", name: "Airtime" },
  { id: "data", name: "Data" },
  { id: "electricity", name: "Electricity" },
  { id: "vouchers", name: "Vouchers" },
  { id: "tv", name: "TV" },
  { id: "water", name: "Water" },
  { id: "gift", name: "Gift cards" },
] as const;

export const friends = [
  { id: "f1", name: "Chernat Tuck Shop" },
  { id: "f2", name: "Halaluye Tuck Shop" },
  { id: "f3", name: "Internet Cafe #1" },
];

export const accounts = [
  { id: "a1", type: "System Account", name: "Shop Account" },
];

export const transactions = [
  { id: "t1", label: "Card •••• 1974", date: "03 Nov 2026 18:34", amount: 21.45, ok: true },
  { id: "t2", label: "Card •••• 1974", date: "03 Nov 2026 17:34", amount: 19.5, ok: true },
  { id: "t3", label: "Card •••• 1974", date: "03 Nov 2026 17:21", amount: 35.1, ok: false },
  { id: "t4", label: "Card •••• 1974", date: "03 Nov 2026 16:42", amount: 22.42, ok: true },
  { id: "t5", label: "Card •••• 1974", date: "03 Nov 2026 16:41", amount: 53.62, ok: true },
  { id: "t6", label: "Card •••• 1974", date: "03 Nov 2026 16:12", amount: 85.8, ok: true },
  { id: "t7", label: "Card •••• 1974", date: "03 Nov 2026 14:54", amount: 53.62, ok: true },
];

export const countries = [
  { code: "BD", name: "Bangladesh" },
  { code: "KE", name: "Kenya" },
  { code: "SO", name: "Somalia" },
  { code: "ET", name: "Ethiopia" },
  { code: "PK", name: "Pakistan" },
];

export const devices = [{ id: "d1", name: "My Card Machine", serial: "40161974" }];

export type Message = {
  id: string;
  kind: "features" | "promotions";
  title: string;
  body: string;
  banner: { headline: string; sub: string };
  date: string;
  terms?: boolean;
};

export const messages: Message[] = [
  {
    id: "m1",
    kind: "promotions",
    title: "Get ready to win big!",
    body: "Sell over R5 000 in vouchers between September and December 2026 for your chance to win the grand prize.",
    banner: { headline: "Win big this festive season", sub: "Sell over R5 000 in vouchers to enter the draw" },
    date: "28 Oct",
    terms: true,
  },
  {
    id: "m2",
    kind: "promotions",
    title: "Your chance to win R5 000!",
    body: "Sell vouchers for your chance to win. One winner in every province, every month. Terms apply.",
    banner: { headline: "One winner every province", sub: "Every month through the festive season" },
    date: "21 Oct",
    terms: true,
  },
  {
    id: "m3",
    kind: "features",
    title: "Money transfer now covers five countries",
    body: "Send money to Bangladesh, Kenya, Somalia, Ethiopia and Pakistan straight from the app.",
    banner: { headline: "Send money abroad", sub: "Five countries, one tap" },
    date: "14 Oct",
  },
];
