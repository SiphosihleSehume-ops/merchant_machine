# Merchant & Payment Machine: front end

Next.js (App Router) + TypeScript. Mobile-first merchant UI, dark theme with an orange accent.

    npm install
    npm run dev      # http://localhost:3000

## Where things live
- `app/globals.css`: all design tokens (colours, radii, spacing) at the top. Change `--accent` to re-theme.
- `components/Logo.tsx`: placeholder brand mark. Replace its contents with the real logo.
- `lib/data.ts`: placeholder data (merchant, suppliers, transactions...). Swap for API calls.
- `lib/nav.ts`: home tile list, also reused by the Menu page.
- `app/<route>/page.tsx`: one folder per screen.

## Screens
Home, Suppliers (sort / distance / favourites + search), Top ups, Transfers, History,
Stock advance, Money transfer (+ per-country stub), Accounts, Orders, Profile, Devices,
Inbox, Share code (QR), Request payment, Cart, Scan, Menu.
