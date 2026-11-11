import {
  clearAuthRecord,
  DEFAULT_API_BASE_URL,
  DEFAULT_WEB_BASE_URL,
  EXTENSION_VERSION,
  getAuthRecord,
  saveAuthRecord,
} from "./storage";
import type {
  ExtensionAuthRecord,
  ExtensionUser,
  JobSummary,
  PreferencesSummary,
  ProfileSummary,
} from "./types";

export class ExtensionApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ExtensionApiError";
    this.code = code;
    this.status = status;
  }
}

async function parseApiError(res: Response): Promise<ExtensionApiError> {
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string };
      detail?: string;
    };
    return new ExtensionApiError(
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? body.detail ?? `Request failed (${res.status})`,
      res.status,
    );
  } catch {
    return new ExtensionApiError("REQUEST_FAILED", `Request failed (${res.status})`, res.status);
  }
}

export async function extFetch<T>(
  path: string,
  init: RequestInit = {},
  override?: { apiBaseUrl?: string; token?: string },
): Promise<T> {
  const auth = await getAuthRecord();
  const baseUrl = (override?.apiBaseUrl ?? auth?.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  const token = override?.token ?? auth?.accessToken;

  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const err = await parseApiError(res);
    if (res.status === 401 && auth && token === auth.accessToken) {
      await clearAuthRecord();
    }
    throw err;
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export async function checkApiHealth(apiBaseUrl = DEFAULT_API_BASE_URL): Promise<boolean> {
  try {
    const res = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/v1/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function exchangePairingToken(
  pairingToken: string,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  webBaseUrl = DEFAULT_WEB_BASE_URL,
): Promise<ExtensionAuthRecord> {
  const cleanApi = apiBaseUrl.replace(/\/+$/, "");
  const cleanWeb = webBaseUrl.replace(/\/+$/, "");
  const res = await extFetch<{
    access_token: string;
    expires_at: string;
    connection_id: string;
    user: ExtensionUser;
  }>(
    "/v1/extensions/exchange",
    {
      method: "POST",
      body: JSON.stringify({
        pairing_token: pairingToken.trim(),
        version: EXTENSION_VERSION,
      }),
    },
    { apiBaseUrl: cleanApi, token: "" },
  );

  const record: ExtensionAuthRecord = {
    accessToken: res.access_token,
    expiresAt: res.expires_at,
    connectionId: res.connection_id,
    userEmail: res.user.email,
    apiBaseUrl: cleanApi,
    webBaseUrl: cleanWeb,
  };
  await saveAuthRecord(record);
  return record;
}

export async function signInAndPairExtension(
  email: string,
  password: string,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  webBaseUrl = DEFAULT_WEB_BASE_URL,
): Promise<ExtensionAuthRecord> {
  const cleanApi = apiBaseUrl.replace(/\/+$/, "");
  const cleanWeb = webBaseUrl.replace(/\/+$/, "");
  const authRes = await extFetch<{ access_token: string }>(
    "/v1/auth/signin",
    {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), password }),
    },
    { apiBaseUrl: cleanApi, token: "" },
  );

  const paired = await extFetch<{ pairing_token: string }>(
    "/v1/extensions/pair",
    {
      method: "POST",
      body: JSON.stringify({ version: EXTENSION_VERSION }),
    },
    { apiBaseUrl: cleanApi, token: authRes.access_token },
  );

  return exchangePairingToken(paired.pairing_token, cleanApi, cleanWeb);
}

export async function loadContextWorkspace(): Promise<{
  profile: ProfileSummary;
  jobs: JobSummary[];
  preferences: PreferencesSummary;
}> {
  const [profile, jobs, preferences] = await Promise.all([
    extFetch<ProfileSummary>("/v1/profile"),
    extFetch<JobSummary[]>("/v1/jobs"),
    extFetch<PreferencesSummary>("/v1/preparation/preferences"),
  ]);
  return { profile, jobs, preferences };
}

export async function sendExtensionHeartbeat(connectionId: string): Promise<void> {
  await extFetch("/v1/extensions/heartbeat", {
    method: "POST",
    body: JSON.stringify({ version: EXTENSION_VERSION, connection_id: connectionId }),
  });
}

export async function createLiveSession(input: {
  jobId: string | null;
  interviewType: string;
  retainTranscript: boolean;
}): Promise<{ id: string; wsToken: string; wsUrl: string }> {
  const auth = await getAuthRecord();
  const baseUrl = (auth?.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");

  const created = await extFetch<{ id: string }>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      job_id: input.jobId,
      state: "listening",
      transcript_retained: input.retainTranscript,
      interview_type: input.interviewType,
    }),
  });

  const wsData = await extFetch<{ ws_token: string; ws_path: string }>(
    `/v1/sessions/${created.id}/token`,
    { method: "POST" },
  );

  const wsBase = baseUrl.replace(/^http/i, "ws");
  return {
    id: created.id,
    wsToken: wsData.ws_token,
    wsUrl: `${wsBase}${wsData.ws_path}`,
  };
}

export async function stopLiveSession(sessionId: string): Promise<void> {
  await extFetch(`/v1/sessions/${sessionId}/stop`, { method: "POST" });
}

