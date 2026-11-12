import "./style.css";
import { buildWsUrl, DEFAULT_API_BASE, normalizeApiBase, PairingError, redeemPairingCode, type PairedSession } from "../../lib/api";
import { plainReason, plainStartError } from "../../lib/plain";
import { reduceEvent } from "../../lib/state";
import { clearPairedSession, loadApiBase, loadInvokedTab, loadPairedSession, saveApiBase, savePairedSession, type InvokedTab } from "../../lib/storage";
import { checkTabEligibility } from "../../lib/tab-eligibility";
import { emptyState, type CaptureMode, type LiveAnswer, type PanelMessage, type PanelState } from "../../lib/types";

type Phase = "pairing" | "ready" | "live" | "ended";

const root = document.getElementById("app") as HTMLElement;
let phase: Phase = "pairing";
let apiBase = DEFAULT_API_BASE;
let paired: PairedSession | null = null;
let state: PanelState = emptyState();
let invoked: InvokedTab | null = null;
let activeTabId: number | null = null;
let error = "";
let busy = false;
let textSize = 17;
let wantMic = false;
let wantRoom = false; // phone or in-person: the microphone hears the interviewer
let wantOverlay = false;
let overlayOn = false;
let waitingForMic = false;

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
const compact = (nodes: (HTMLElement | null)[]): HTMLElement[] => nodes.filter((n): n is HTMLElement => n !== null);
function button(label: string, cls: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el("button", { class: cls, text: label, on: { click: onClick } });
  b.disabled = disabled;
  return b;
}
function toggle(label: string, on: boolean, onChange: (v: boolean) => void, hint = ""): HTMLElement {
  const box = el("input", { attrs: { type: "checkbox", "aria-label": label } });
  (box as HTMLInputElement).checked = on;
  box.addEventListener("change", () => onChange((box as HTMLInputElement).checked));
  return el("label", { class: "toggle" }, [box, el("span", {}, [el("span", { text: label }), hint ? el("small", { text: hint }) : null])]);
}

/* ------------------------------------------------------------ what Chrome lets us do on this tab */
/** The tab the user clicked the Vren icon on. Chrome only allows capture and drawing on that tab. */
const invokedIsActive = (): boolean => invoked !== null && activeTabId === invoked.tabId;
const hostLabel = (): string => (invoked?.url ? checkTabEligibility(invoked.url).hostLabel : "");

async function refreshTab(): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = active?.id ?? null;
  invoked = await loadInvokedTab();
}

/* ------------------------------------------------------------ actions */
async function connect(code: string, serverInput: string): Promise<void> {
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
    error = err instanceof PairingError ? err.message : "Could not connect. Check the address and try again.";
  } finally {
    busy = false;
    render();
  }
}

async function micAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}

async function send(mode: CaptureMode): Promise<{ ok: boolean; code?: string; error?: string } | null> {
  if (!paired) return null;
  return (await chrome.runtime
    .sendMessage({ target: "background", type: "START", mode, tabId: invoked?.tabId ?? activeTabId ?? -1, wsUrl: buildWsUrl(apiBase, paired.wsPath, paired.wsToken), mic: wantMic || wantRoom })
    .catch(() => null)) as { ok: boolean; code?: string; error?: string } | null;
}

async function start(): Promise<void> {
  if (!paired) return;
  error = "";
  if ((wantMic || wantRoom) && !(await micAllowed())) {
    // The panel cannot show Chrome's microphone prompt, so a normal tab does it.
    waitingForMic = true;
    error = "Allow your microphone in the new tab, then press Start.";
    void chrome.tabs.create({ url: chrome.runtime.getURL("permissions.html") });
    render();
    return;
  }
  busy = true;
  render();
  await refreshTab();
  // One click on this tab when Chrome allows it. Otherwise Chrome's own tab chooser.
  let res = wantRoom ? await send("room") : await send(invokedIsActive() && invoked?.url && checkTabEligibility(invoked.url).eligible ? "tab" : "picker");
  if (res && !res.ok && res.code === "NEEDS_PICKER") res = await send("picker");
  busy = false;
  if (res?.ok) {
    state = emptyState();
    phase = "live";
    if (wantOverlay) await turnOverlayOn();
  } else {
    error = plainStartError(res?.code);
  }
  render();
}

/** Takes a picture of the meeting tab so Vren can read a question or problem shown on screen. */
async function readScreen(): Promise<void> {
  await refreshTab();
  if (!invokedIsActive()) {
    error = "Click the Vren icon on that tab first, then try again.";
    render();
    return;
  }
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "jpeg", quality: 70 });
    const [, image = ""] = dataUrl.split(",");
    await chrome.runtime.sendMessage({ target: "offscreen", type: "OFFSCREEN_IMAGE", image, mime: "image/jpeg" });
    error = "";
  } catch {
    error = "Could not take a picture of the tab.";
  }
  render();
}

function control(type: "PAUSE" | "RESUME" | "STOP"): void {
  void chrome.runtime.sendMessage({ target: "background", type });
}

async function turnOverlayOn(): Promise<void> {
  await refreshTab();
  if (!invoked || !invokedIsActive()) {
    error = "Click the Vren icon on your meeting tab, then try again.";
    overlayOn = false;
    return;
  }
  const res = (await chrome.runtime.sendMessage({ target: "background", type: "OVERLAY_ENABLE", tabId: invoked.tabId }).catch(() => null)) as { ok: boolean; error?: string } | null;
  overlayOn = res?.ok === true;
  error = res?.ok ? "" : (res?.error ?? "Could not show answers on the page.");
}

async function turnOverlayOff(): Promise<void> {
  await chrome.runtime.sendMessage({ target: "background", type: "OVERLAY_DISABLE" }).catch(() => null);
  overlayOn = false;
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
    a.code ? el("pre", { class: "code", text: a.code }) : null,
    a.key_points.length ? el("ul", { class: "points" }, a.key_points.map((k) => el("li", { text: k }))) : null,
    el("p", { class: "source", text: a.caveat ? `${a.source_label} · ${a.caveat}` : a.source_label }),
  ]);
}

function viewPairing(): HTMLElement[] {
  const code = el("input", { attrs: { inputmode: "numeric", maxlength: "6", placeholder: "000000", "aria-label": "6-digit code", autocomplete: "off" } });
  const server = el("input", { class: "plain", attrs: { "aria-label": "Server address" } });
  (server as HTMLInputElement).value = apiBase;
  const go = () => void connect((code as HTMLInputElement).value, (server as HTMLInputElement).value);
  code.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") go();
  });
  return compact([
    el("div", { class: "card" }, [
      el("p", { text: "Type the 6-digit code from the Vren website." }),
      code,
      button(busy ? "Connecting…" : "Connect", "primary wide", go, busy),
      error ? el("p", { class: "error", text: error, attrs: { role: "alert" } }) : null,
    ]),
    el("details", {}, [el("summary", { text: "Advanced" }), el("label", { class: "muted", text: "Server address" }), server]),
  ]);
}

function viewReady(): HTMLElement[] {
  const direct = invokedIsActive() && invoked?.url && checkTabEligibility(invoked.url).eligible;
  const startLabel = wantRoom || direct ? "Start" : "Pick a tab and start";
  const overlayReady = invokedIsActive();
  return compact([
    el("div", { class: "card" }, [
      el("p", { class: "strong", text: paired?.jobTitle ? paired.jobTitle : "Connected" }),
      el("p", { class: "muted", text: wantRoom ? "Listening with your microphone." : direct ? `Listening to: ${hostLabel()}` : "You will pick the tab next." }),
    ]),
    el("div", { class: "card" }, [
      toggle("Phone or in-person interview", wantRoom, (v) => ((wantRoom = v), render()), "Uses your microphone to hear the room"),
      wantRoom ? null : toggle("Listen to my voice too", wantMic, (v) => ((wantMic = v), render()), waitingForMic ? "Allow it in the new tab" : ""),
      toggle("Show answers on the page", wantOverlay, (v) => ((wantOverlay = v), render()), overlayReady ? "" : "Click the Vren icon on that tab first"),
    ]),
    error ? el("p", { class: "error", text: error, attrs: { role: "alert" } }) : null,
    button(busy ? "Starting…" : startLabel, "primary wide", () => void start(), busy),
    el("details", {}, [
      el("summary", { text: "What does this do?" }),
      el("p", { class: "muted", text: "Vren hears the sound you choose and sends it to Vren AI to write answers. It does not keep the audio." }),
      el("p", { class: "muted", text: "If you share your whole screen in a call, others may see this panel." }),
    ]),
    button("Disconnect", "link", () => void unpair()),
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
  else if (!state.pending) out.push(el("p", { class: "muted center", text: "Listening…" }));
  if (earlier.length) out.push(el("details", {}, [el("summary", { text: `Earlier (${earlier.length})` }), ...earlier.map((a) => answerCard(a, false))]));
  if (state.transcript.length) {
    out.push(el("details", {}, [el("summary", { text: "What was said" }), el("ul", { class: "transcript" }, state.transcript.map((t) => el("li", { text: `${t.speaker}: ${t.text}` })))]));
  }
  out.push(button("Read the question on screen", "link", () => void readScreen()));
  out.push(button(overlayOn ? "Hide answers on the page" : "Show answers on the page", "link", () => void (overlayOn ? turnOverlayOff() : turnOverlayOn()).then(render)));
  if (error) out.push(el("p", { class: "error", text: error, attrs: { role: "alert" } }));
  return compact(out);
}

function viewEnded(): HTMLElement[] {
  return [
    el("div", { class: "card" }, [el("p", { class: "strong", text: "Session ended" }), el("p", { class: "muted", text: "Open the Vren website to review it." })]),
    button("Connect a new session", "primary wide", () => void unpair()),
  ];
}

function pills(): HTMLElement[] {
  if (phase !== "live") return [];
  const conn = state.connection;
  return [
    el("span", { class: `pill ${conn === "connected" ? "ok" : "warn"}`, text: conn === "connected" ? "Connected" : conn === "closed" ? "Offline" : "Reconnecting" }),
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
  root.replaceChildren(el("header", {}, [el("h1", { text: "Vren AI" }), el("div", { class: "row" }, pills())]), el("main", {}, body), ...(footer.length ? [el("footer", {}, footer)] : []));
}

/* ------------------------------------------------------------ events */
chrome.runtime.onMessage.addListener((raw: PanelMessage) => {
  if (!raw || raw.target !== "panel") return;
  if (raw.type === "CLOSE") {
    window.close(); // the on-page overlay took over
    return;
  }
  if (raw.type === "MIC_GRANTED") {
    waitingForMic = false;
    error = "";
  } else if (raw.type === "SERVER_EVENT") {
    state = reduceEvent(state, raw.event);
    if (state.ended) phase = "ended";
  } else if (raw.type === "STATUS") {
    state = { ...state, connection: raw.status };
    if (raw.status === "closed" && phase === "live") {
      const why = plainReason(raw.detail);
      if (why) state = { ...state, notice: why };
      if (state.ended) phase = "ended";
    }
  } else if (raw.type === "ERROR") {
    error = raw.message;
  }
  render();
});

chrome.tabs.onActivated.addListener(() => void refreshTab().then(render));
chrome.storage.session.onChanged.addListener(() => void refreshTab().then(render));

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
    const snap = (await chrome.runtime.sendMessage({ target: "offscreen", type: "OFFSCREEN_SNAPSHOT" }).catch(() => null)) as { ok: boolean; active: boolean; state: PanelState } | null;
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
