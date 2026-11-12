export interface PairedSession {
  sessionId: string;
  wsToken: string;
  wsPath: string;
  expiresAt: string;
  jobTitle: string;
  company: string;
}

export class PairingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PairingError";
    this.code = code;
  }
}

export const DEFAULT_API_BASE = (import.meta.env?.["WXT_API_ORIGIN"] as string | undefined) ?? "http://localhost:8000";

export function normalizeApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const parsed = new URL(trimmed); // throws on garbage
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new PairingError("INSECURE_ORIGIN", "The server address must use https.");
  }
  return parsed.origin;
}

export function buildWsUrl(apiBase: string, wsPath: string, token: string): string {
  const url = new URL(wsPath, apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

/** Exchanges the 6-digit code shown in the web app for a token scoped to that one live session. */
export async function redeemPairingCode(apiBase: string, code: string): Promise<PairedSession> {
  if (!/^\d{6}$/.test(code)) {
    throw new PairingError("BAD_CODE_FORMAT", "Enter the 6-digit code from the Vren web app.");
  }
  let res: Response;
  try {
    res = await fetch(`${apiBase}/v1/pairing/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  } catch {
    throw new PairingError("NETWORK", "Could not reach Vren AI. Check your connection and the server address.");
  }
  if (!res.ok) {
    let message = "That code is invalid or has expired.";
    let code_ = "PAIRING_CODE_INVALID";
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      message = body.error?.message ?? message;
      code_ = body.error?.code ?? code_;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 429) message = "Too many attempts. Wait a few minutes and try again.";
    throw new PairingError(code_, message);
  }
  const body = (await res.json()) as {
    session_id: string;
    ws_token: string;
    ws_path: string;
    expires_at: string;
    job_title?: string;
    company?: string;
  };
  return {
    sessionId: body.session_id,
    wsToken: body.ws_token,
    wsPath: body.ws_path,
    expiresAt: body.expires_at,
    jobTitle: body.job_title ?? "",
    company: body.company ?? "",
  };
}
