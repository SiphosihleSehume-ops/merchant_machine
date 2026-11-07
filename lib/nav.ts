import {
  Wallet, Smartphone, ArrowLeftRight, Receipt, HandCoins, Banknote, CreditCard, ShoppingBasket,
} from "lucide-react";

export const tiles = [
  { href: "/suppliers", label: "Pay suppliers", Icon: Wallet },
  { href: "/top-ups", label: "Top ups", Icon: Smartphone },
  { href: "/transfers", label: "Transfers", Icon: ArrowLeftRight },
  { href: "/history", label: "History", Icon: Receipt },
  { href: "/stock-advance", label: "Stock advance", Icon: HandCoins },
  { href: "/money-transfer", label: "Money transfer", Icon: Banknote },
  { href: "/accounts", label: "My accounts", Icon: CreditCard },
  { href: "/orders", label: "Order", Icon: ShoppingBasket },
];
