import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import AuthGate from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "Merchant & Payment Machine",
  description: "Pay and get paid with ZARK and USDC stablecoins.",
};

export const viewport: Viewport = {
  themeColor: "#0e0f11",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <AuthProvider>
            <AuthGate>{children}</AuthGate>
          </AuthProvider>
        </div>
      </body>
    </html>
  );
}
