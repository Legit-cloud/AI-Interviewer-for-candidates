import "./style.css";
import { buildWsUrl, DEFAULT_API_BASE, normalizeApiBase, PairingError, redeemPairingCode, type PairedSession } from "../../lib/api";
import { reduceEvent } from "../../lib/state";
import { clearPairedSession, loadApiBase, loadPairedSession, saveApiBase, savePairedSession } from "../../lib/storage";
import { checkTabEligibility, type TabEligibility } from "../../lib/tab-eligibility";
import { emptyState, type LiveAnswer, type PanelMessage, type PanelState } from "../../lib/types";

type Phase = "pairing" | "ready" | "live" | "ended";

const root = document.getElementById("app") as HTMLElement;
let phase: Phase = "pairing";
let apiBase = DEFAULT_API_BASE;
let paired: PairedSession | null = null;
let state: PanelState = emptyState();
let tab: { id: number; eligibility: TabEligibility } | null = null;
let error = "";
let busy = false;
let textSize = 17;

/* ------------------------------------------------------------ tiny DOM helpers (text only, never innerHTML) */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; attrs?: Record<string, string>; on?: Record<string, (e: Event) => void> } = {},
  children: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [k, fn] of Object.entries(props.on ?? {})) node.addEventListener(k, fn);
  for (const c of children) if (c) node.append(c);
  return node;
}

function compact(nodes: (HTMLElement | null)[]): HTMLElement[] {
  return nodes.filter((n): n is HTMLElement => n !== null);
}

function button(label: string, cls: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el("button", { class: cls, text: label, on: { click: onClick } });
  b.disabled = disabled;
  return b;
}

/* ------------------------------------------------------------ actions */
async function refreshTab(): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = active?.id !== undefined ? { id: active.id, eligibility: checkTabEligibility(active.url) } : null;
}

async function submitCode(code: string, serverInput: string): Promise<void> {
  busy = true;
  error = "";
  render();
  try {
    if (serverInput.trim() && serverInput.trim() !== apiBase) {
      apiBase = normalizeApiBase(serverInput);
      await saveApiBase(apiBase);
    }
    paired = await redeemPairingCode(apiBase, code.trim());
    await savePairedSession(paired);
    state = emptyState();
    phase = "ready";
    await refreshTab();
  } catch (err) {
    error = err instanceof PairingError ? err.message : "Could not pair. Check the server address and try again.";
  } finally {
    busy = false;
    render();
  }
}

async function startCapture(): Promise<void> {
  if (!paired || !tab) return;
  busy = true;
  error = "";
  render();
  const res = (await chrome.runtime
    .sendMessage({ target: "background", type: "START", tabId: tab.id, wsUrl: buildWsUrl(apiBase, paired.wsPath, paired.wsToken) })
    .catch(() => null)) as { ok: boolean; error?: string } | null;
  busy = false;
  if (res?.ok) {
    state = emptyState();
    phase = "live";
  } else {
    error = res?.error ?? "Capture did not start. Click the Vren icon on the interview tab and try again.";
  }
  render();
}

function control(type: "PAUSE" | "RESUME" | "STOP"): void {
  void chrome.runtime.sendMessage({ target: "background", type });
}

async function unpair(): Promise<void> {
  await clearPairedSession();
  paired = null;
  state = emptyState();
  phase = "pairing";
  render();
}

function setTextSize(delta: number): void {
  textSize = Math.min(28, Math.max(13, textSize + delta));
  document.documentElement.style.setProperty("--size", `${textSize}px`);
  void chrome.storage.local.set({ "vren-text-size": textSize });
}

/* ------------------------------------------------------------ views */
function answerCard(a: LiveAnswer, big: boolean): HTMLElement {
  return el("article", { class: "card" }, [
    el("p", { class: "question", text: a.question_text }),
    el("p", { class: big ? "answer big" : "answer", text: a.answer }),
    a.key_points.length ? el("ul", { class: "points" }, a.key_points.map((k) => el("li", { text: k }))) : null,
    el("p", { class: "source", text: a.caveat ? `${a.source_label} · ${a.caveat}` : a.source_label }),
  ]);
}

function viewPairing(): HTMLElement[] {
  const code = el("input", { attrs: { inputmode: "numeric", maxlength: "6", placeholder: "000000", "aria-label": "Pairing code", autocomplete: "off" } });
  const server = el("input", { class: "plain", attrs: { value: apiBase, "aria-label": "Server address" } });
  (server as HTMLInputElement).value = apiBase;
  const go = () => void submitCode((code as HTMLInputElement).value, (server as HTMLInputElement).value);
  code.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") go();
  });
  return compact([
    el("div", { class: "card" }, [
      el("p", { text: "Enter the 6-digit code shown on the Vren web app when you start a live session." }),
      code,
      el("div", { class: "row" }, [button(busy ? "Pairing…" : "Pair", "primary", go, busy)]),
      error ? el("p", { class: "error", text: error, attrs: { role: "alert" } }) : null,
    ]),
    el("details", {}, [el("summary", { text: "Server address" }), server]),
    el("p", { class: "muted", text: "This panel only displays your answers. Nothing is captured until you press Start capture." }),
  ]);
}

function viewReady(): HTMLElement[] {
  const ok = tab?.eligibility.eligible ?? false;
  return compact([
    el("div", { class: "card" }, [
      el("p", { text: paired?.jobTitle ? `Paired: ${paired.jobTitle}${paired.company ? ` · ${paired.company}` : ""}` : "Paired with your live session." }),
      el("p", { class: "muted", text: tab ? `Tab: ${tab.eligibility.hostLabel}. ${tab.eligibility.reason}` : "Open your interview tab, then click the Vren icon on it." }),
    ]),
    el("div", { class: "card" }, [
      el("p", { text: "What Start capture does" }),
      el("p", { class: "muted", text: "It streams the audio of the tab above to Vren AI for live transcription while the session runs. Raw audio is not kept. Chrome shows its own recording indicator on that tab, and you can stop at any time." }),
    ]),
    el("div", { class: "hint", text: "Answers appear only in this panel. The panel is part of your browser window: sharing a single tab does not include it, but sharing your whole screen or browser window may show it. Check what you are sharing." }),
    error ? el("p", { class: "error", text: error, attrs: { role: "alert" } }) : null,
    el("div", { class: "row" }, [
      button(busy ? "Starting…" : "Start capture", "primary", () => void startCapture(), busy || !ok),
      button("Unpair", "", () => void unpair()),
    ]),
  ]);
}

function viewLive(): HTMLElement[] {
  const latest = state.answers[0];
  const earlier = state.answers.slice(1);
  const out: (HTMLElement | null)[] = [];
  if (state.notice) out.push(el("div", { class: "hint", text: state.notice, attrs: { role: "status" } }));
  if (state.pending) {
    out.push(
      el("article", { class: "card pending" }, [
        el("p", { class: "question", text: state.pending.question }),
        el("p", { class: "answer big", text: state.pending.text || "…" }),
      ]),
    );
  }
  if (latest) out.push(answerCard(latest, true));
  else if (!state.pending) out.push(el("p", { class: "muted", text: "Listening for questions. Answers will appear here." }));
  if (earlier.length) out.push(el("details", {}, [el("summary", { text: `Earlier answers (${earlier.length})` }), ...earlier.map((a) => answerCard(a, false))]));
  if (state.transcript.length) {
    out.push(
      el("details", {}, [
        el("summary", { text: "Transcript" }),
        el("ul", { class: "transcript" }, state.transcript.map((t) => el("li", { text: `${t.at} ${t.speaker}: ${t.text}` }))),
      ]),
    );
  }
  return compact(out);
}

function viewEnded(): HTMLElement[] {
  return [
    el("div", { class: "card" }, [
      el("p", { text: "Session ended." }),
      el("p", { class: "muted", text: "Open the Vren web app to review your questions and answers." }),
    ]),
    el("div", { class: "row" }, [button("Pair another session", "primary", () => void unpair())]),
  ];
}

function pills(): HTMLElement[] {
  if (phase !== "live") return [];
  const conn = state.connection;
  return [
    el("span", { class: `pill ${conn === "connected" ? "ok" : "warn"}`, text: conn === "connected" ? "Connected" : conn === "closed" ? "Disconnected" : "Reconnecting" }),
    el("span", { class: `pill ${state.capture === "listening" ? "ok" : ""}`, text: state.capture === "listening" ? "Listening" : state.capture === "paused" ? "Paused" : "Starting" }),
  ];
}

function render(): void {
  const body = phase === "pairing" ? viewPairing() : phase === "ready" ? viewReady() : phase === "live" ? viewLive() : viewEnded();
  const footer =
    phase === "live"
      ? [
          state.capture === "paused" ? button("Resume", "", () => control("RESUME")) : button("Pause", "", () => control("PAUSE")),
          button("Stop", "danger", () => control("STOP")),
          button("A−", "", () => setTextSize(-1)),
          button("A+", "", () => setTextSize(1)),
        ]
      : [];
  root.replaceChildren(
    el("header", {}, [el("h1", { text: "Vren AI" }), el("div", { class: "row" }, pills())]),
    el("main", {}, body),
    ...(footer.length ? [el("footer", {}, footer)] : []),
  );
}

/* ------------------------------------------------------------ events from the capture relay */
chrome.runtime.onMessage.addListener((raw: PanelMessage) => {
  if (!raw || raw.target !== "panel") return;
  if (raw.type === "SERVER_EVENT") {
    state = reduceEvent(state, raw.event);
    if (state.ended) phase = "ended";
  } else if (raw.type === "STATUS") {
    state = { ...state, connection: raw.status };
    if (raw.status === "closed" && phase === "live") {
      state = { ...state, notice: raw.detail ?? state.notice };
      if (state.ended) phase = "ended";
    }
  } else if (raw.type === "ERROR") {
    error = raw.message;
  }
  render();
});

chrome.tabs.onActivated.addListener(() => void refreshTab().then(render));

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get("vren-text-size");
  const size = stored["vren-text-size"];
  if (typeof size === "number") textSize = size;
  document.documentElement.style.setProperty("--size", `${textSize}px`);

  apiBase = await loadApiBase(DEFAULT_API_BASE);
  paired = await loadPairedSession();
  await refreshTab();
  if (paired) {
    // The panel can be closed and reopened while capture keeps running; recover its state.
    const snap = (await chrome.runtime.sendMessage({ target: "offscreen", type: "OFFSCREEN_SNAPSHOT" }).catch(() => null)) as
      | { ok: boolean; active: boolean; state: PanelState }
      | null;
    if (snap?.active) {
      state = snap.state;
      phase = state.ended ? "ended" : "live";
    } else {
      phase = "ready";
    }
  }
  render();
}

void init();
