import { API_URL, AUTH_DISABLED } from "./config";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const SESSION_KEY = "mm.session";
/** Test mode only: which side of the demo user is active. */
const DEMO_ROLE_KEY = "mm.demoRole";

function storedDemoRole(): string | null {
  try {
    return localStorage.getItem(DEMO_ROLE_KEY);
  } catch {
    return null;
  }
}

/** Reads the bearer token straight from storage so any module can call the API. */
function storedToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw).token as string) : null;
  } catch {
    return null;
  }
}

/** Auth headers for any API call (bearer token, or the demo role in test mode). */
function authHeaders(useAuth = true): Record<string, string> {
  // Test mode never sends a token: the backend acts as the demo user instead
  const token = !useAuth || AUTH_DISABLED ? null : storedToken();
  const demoRole = AUTH_DISABLED ? storedDemoRole() : null;
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(demoRole ? { "x-demo-role": demoRole } : {}),
  };
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const res = await send(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...authHeaders(init.auth !== false) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return parse<T>(res);
}

/** Multipart upload (files). The browser sets the multipart boundary itself. */
export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  return parse<T>(await send(path, { method: "POST", headers: authHeaders(), body: form }));
}

/** Authenticated binary download (e.g. KYC documents for the verifier). */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await send(path, { headers: authHeaders() });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(res.status, json?.error || `Request failed (${res.status})`);
  }
  return res.blob();
}

async function parse<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Expired token, or the account behind it no longer exists: sign out cleanly
    if ((res.status === 403 && json?.error === "Invalid or expired token.") || json?.code === "SESSION_INVALID") {
      window.dispatchEvent(new Event("mm:session-expired"));
    }
    throw new ApiError(res.status, json?.error || `Request failed (${res.status})`, json?.code);
  }
  return json.data as T;
}

export { SESSION_KEY, DEMO_ROLE_KEY };
