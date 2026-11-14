import { API_URL } from "./config";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_PAY_PREFIX = `${API_URL}/x402/pay/`;
const APP_PAY_PATH = "/customer/pay";

/** Shareable link that opens the invoice straight in the customer Pay screen. */
export function appPayLink(invoiceId: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${APP_PAY_PATH}?invoice=${invoiceId}`;
}

/**
 * Invoice id from a scanned / pasted code. Accepts only OUR links (a QR sticker pointing
 * anywhere else is rejected):
 *   - app link   https://<this app>/customer/pay?invoice=<id>
 *   - API link   <NEXT_PUBLIC_API_URL>/x402/pay/<id>   (older QR codes)
 */
export function invoiceIdFrom(text: string): string | null {
  const t = text.trim();
  if (t.startsWith(API_PAY_PREFIX)) {
    const id = t.slice(API_PAY_PREFIX.length).split(/[?#/]/)[0];
    return UUID.test(id) ? id : null;
  }
  try {
    const url = new URL(t);
    const sameApp = typeof window !== "undefined" && url.origin === window.location.origin;
    if (sameApp && url.pathname === APP_PAY_PATH) {
      const id = url.searchParams.get("invoice") ?? "";
      return UUID.test(id) ? id : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}
