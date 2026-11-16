export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown> | undefined;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const TOKEN_STORAGE_KEY = "vren-auth-tokens";
export const API_BASE =
  (import.meta.env?.["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/+$/, "") ?? "";

let refreshInFlight: Promise<AuthTokens | null> | null = null;

export function getStoredTokens(): AuthTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthTokens>;
    if (!parsed.access_token || !parsed.refresh_token) return null;
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      token_type: parsed.token_type || "bearer",
    };
  } catch {
    return null;
  }
}

export function setStoredTokens(tokens: AuthTokens | null) {
  if (typeof window === "undefined") return;
  if (!tokens) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    return;
  }
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
}

export function hasAuthSession(): boolean {
  return !!getStoredTokens()?.access_token;
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const data = (await res.json()) as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
      detail?: string;
    };
    if (data.error) {
      return new ApiError(
        data.error.code || "api_error",
        data.error.message || `Request failed (${res.status})`,
        res.status,
        data.error.details,
      );
    }
    if (data.detail) {
      return new ApiError("api_error", String(data.detail), res.status);
    }
  } catch {
    /* non-JSON body */
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return new ApiError(
      "backend_unavailable",
      "The backend API server on port 8000 is not reachable. Start it with: cd backend; uv run uvicorn app.main:app --port 8000",
      res.status,
    );
  }
  if (res.status >= 500) {
    return new ApiError(
      "server_error",
      `The server hit an error (${res.status}). If you just updated the app, apply the database migrations (cd backend && uv run alembic upgrade head) and restart the API.`,
      res.status,
    );
  }
  return new ApiError("api_error", `Request failed (${res.status})`, res.status);
}

async function tryRefreshToken(): Promise<AuthTokens | null> {
  const current = getStoredTokens();
  if (!current?.refresh_token) return null;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      if (!res.ok) {
        setStoredTokens(null);
        return null;
      }
      const data = (await res.json()) as AuthTokens;
      setStoredTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: data.token_type || "bearer",
      });
      return getStoredTokens();
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: { auth?: boolean; retryOn401?: boolean } = {},
): Promise<T> {
  const useAuth = options.auth ?? true;
  const retryOn401 = options.retryOn401 ?? true;
  const headers = new Headers(init.headers);

  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (useAuth) {
    const tokens = getStoredTokens();
    if (tokens?.access_token) {
      headers.set("Authorization", `Bearer ${tokens.access_token}`);
    }
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401 && useAuth && retryOn401) {
    const refreshed = await tryRefreshToken();
    if (refreshed?.access_token) {
      return apiFetch<T>(path, init, { auth: useAuth, retryOn401: false });
    }
  }
  if (!res.ok) {
    throw await parseError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
