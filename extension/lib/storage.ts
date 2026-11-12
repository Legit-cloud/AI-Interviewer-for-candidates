import type { PairedSession } from "./api";

const SESSION_KEY = "vren-paired-session";
const API_KEY = "vren-api-base";

/** Pairing token lives in session storage only: it is cleared when the browser closes. */
export async function savePairedSession(s: PairedSession): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: s });
}

export async function loadPairedSession(): Promise<PairedSession | null> {
  const out = await chrome.storage.session.get(SESSION_KEY);
  const s = out[SESSION_KEY] as PairedSession | undefined;
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() <= Date.now()) {
    await clearPairedSession();
    return null;
  }
  return s;
}

export async function clearPairedSession(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function loadApiBase(fallback: string): Promise<string> {
  const out = await chrome.storage.local.get(API_KEY);
  return (out[API_KEY] as string | undefined) ?? fallback;
}

export async function saveApiBase(value: string): Promise<void> {
  await chrome.storage.local.set({ [API_KEY]: value });
}
