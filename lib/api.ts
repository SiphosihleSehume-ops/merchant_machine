import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const SESSION_KEY = "mm.session";

/** Reads the bearer token straight from storage so any module can call the API. */
function storedToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw).token as string) : null;
  } catch {
    return null;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const token = init.auth === false ? null : storedToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403 && json?.error === "Invalid or expired token.") {
      window.dispatchEvent(new Event("mm:session-expired"));
    }
    throw new ApiError(res.status, json?.error || `Request failed (${res.status})`, json?.code);
  }
  return json.data as T;
}

export { SESSION_KEY };
