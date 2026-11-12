import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { reduceEvent } from "../../extension/lib/state";
import { plainReason } from "../../extension/lib/plain";
import { emptyState, type PanelState, type ServerEvent } from "../../extension/lib/types";
import "./style.css";

interface Device { id: string; label: string; kind: string; is_default: boolean; hears_system: boolean }
interface Paired { session_id: string; ws_token: string; ws_path: string; job_title: string; company: string; ws_url: string }
type Phase = "pairing" | "ready" | "live" | "ended";

const root = document.getElementById("app") as HTMLElement;
let phase: Phase = "pairing";
let state: PanelState = emptyState();
let paired: Paired | null = null;
let devices: Device[] = [];
let server = localStorage.getItem("vren-server") ?? "http://localhost:8000";
let displayOnly = false;
let room = false;
let wantMic = false;
let systemDevice = "";
let micDevice = "";
let overlayOn = false;
let locked = false;
let error = "";
let busy = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; text?: string; attrs?: Record<string, string> } = {}, kids: (Node | null)[] = []): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (props.class) n.className = props.class;
  if (props.text !== undefined) n.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) n.setAttribute(k, v);
  for (const k of kids) if (k) n.append(k);
  return n;
}
const compact = (nodes: (HTMLElement | null)[]): HTMLElement[] => nodes.filter((n): n is HTMLElement => n !== null);
const btn = (label: string, cls: string, on: () => void, disabled = false) => {
  const b = el("button", { class: cls, text: label });
  b.disabled = disabled;
  b.addEventListener("click", on);
  return b;
};
function check(label: string, on: boolean, change: (v: boolean) => void, hint = "") {
  const box = el("input", { attrs: { type: "checkbox", "aria-label": label } });
  (box as HTMLInputElement).checked = on;
  box.addEventListener("change", () => change((box as HTMLInputElement).checked));
  return el("label", { class: "row" }, [box, el("span", {}, [el("span", { text: label }), hint ? el("span", { class: "muted", text: " " + hint }) : null])]);
}
function pick(label: string, list: Device[], value: string, change: (v: string) => void) {
  const s = el("select", { attrs: { "aria-label": label } });
  for (const d of list) {
    const o = el("option", { text: d.label });
    o.value = d.id;
    s.append(o);
  }
  s.value = value || list[0]?.id || "";
  s.addEventListener("change", () => change(s.value));
  return s;
}

const systemOptions = () => [...devices.filter((d) => d.hears_system), ...devices.filter((d) => !d.hears_system)];
const micOptions = () => devices.filter((d) => !d.hears_system && d.kind === "input");

function setupTip(): string {
  const os = navigator.userAgent;
  if (os.includes("Mac")) return "On a Mac, install a free tool such as BlackHole, send your call's sound to it, then choose it here.";
  if (os.includes("Windows")) return "Choose the speakers or headphones your call plays through.";
  return "Choose the “Monitor of …” entry for the speakers your call plays through.";
}

async function connect(code: string) {
  busy = true; error = ""; render();
  try {
    localStorage.setItem("vren-server", server);
    paired = await invoke<Paired>("redeem", { server, code: code.trim(), role: displayOnly ? "display" : "capture" });
    devices = await invoke<Device[]>("list_devices");
    systemDevice = systemOptions()[0]?.id ?? "";
    micDevice = micOptions().find((d) => d.is_default)?.id ?? micOptions()[0]?.id ?? "";
    state = emptyState();
    phase = "ready";
  } catch (e) { error = String(e); }
  busy = false; render();
}

async function start() {
  if (!paired) return;
  busy = true; error = ""; render();
  try {
    await invoke("start", { args: {
      ws_url: paired.ws_url,
      display_only: displayOnly,
      room,
      system_device: displayOnly || room || !systemDevice ? null : systemDevice,
      mic_device: displayOnly ? null : room || wantMic ? micDevice || null : null,
    } });
    phase = "live";
    if (overlayOn || displayOnly) await showOverlay(true);
  } catch (e) { error = String(e); }
  busy = false; render();
}

async function showOverlay(on: boolean) {
  await invoke(on ? "overlay_show" : "overlay_hide");
  overlayOn = on;
  if (on) await emit("vren://state", state);
}

async function toggleLock() {
  locked = !locked;
  await invoke("overlay_lock", { locked });
  render();
}

async function unpair() {
  await invoke("stop").catch(() => {});
  await showOverlay(false).catch(() => {});
  paired = null; state = emptyState(); phase = "pairing"; render();
}

function viewPairing(): HTMLElement[] {
  const code = el("input", { class: "code", attrs: { type: "text", inputmode: "numeric", maxlength: "6", placeholder: "000000", "aria-label": "6-digit code", autocomplete: "off" } });
  const addr = el("input", { attrs: { type: "text", "aria-label": "Server address" } });
  (addr as HTMLInputElement).value = server;
  addr.addEventListener("input", () => (server = (addr as HTMLInputElement).value));
  const go = () => void connect((code as HTMLInputElement).value);
  code.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") go(); });
  return [
    el("div", { class: "card" }, [
      el("p", { text: "Type the 6-digit code from the Vren website." }),
      code,
      check("Only show answers", displayOnly, (v) => { displayOnly = v; render(); }, "(another Vren app is listening)"),
      btn(busy ? "Connecting…" : "Connect", "primary", go, busy),
      error ? el("p", { class: "error", text: error, attrs: { role: "alert" } }) : null,
    ]),
    el("details", {}, [el("summary", { text: "Advanced" }), el("p", { class: "muted", text: "Server address" }), addr]),
  ];
}

function viewReady(): HTMLElement[] {
  const none = devices.length === 0;
  return compact([
    el("div", { class: "card" }, [el("p", { text: paired?.job_title || "Connected" }), displayOnly ? el("p", { class: "muted", text: "This app will only show answers." }) : null]),
    displayOnly ? null : el("div", { class: "card" }, [
      check("Phone or in-person interview", room, (v) => { room = v; render(); }, "uses your microphone to hear the room"),
      room ? null : el("p", { class: "muted", text: "Sound to listen to" }),
      room ? null : pick("Sound to listen to", systemOptions(), systemDevice, (v) => (systemDevice = v)),
      room ? null : el("p", { class: "muted", text: setupTip() }),
      room ? null : check("Also listen to my voice", wantMic, (v) => { wantMic = v; render(); }),
      room || wantMic ? pick("Microphone", micOptions(), micDevice, (v) => (micDevice = v)) : null,
      none ? el("p", { class: "error", text: "No sound devices were found." }) : null,
    ]),
    el("div", { class: "card" }, [check("Show the answers box", overlayOn || displayOnly, (v) => { overlayOn = v; }, "")]),
    error ? el("p", { class: "error", text: error, attrs: { role: "alert" } }) : null,
    btn(busy ? "Starting…" : "Start", "primary", () => void start(), busy),
    el("p", { class: "muted", text: "The answers box is a normal window, so it can appear if you share your whole screen. Nothing is saved from the audio." }),
    btn("Disconnect", "link", () => void unpair()),
  ]);
}

function viewLive(): HTMLElement[] {
  const a = state.answers[0];
  return compact([
    state.notice ? el("div", { class: "hint", text: state.notice, attrs: { role: "status" } }) : null,
    el("div", { class: "card" }, [
      state.pending ? el("p", { class: "muted", text: state.pending.question }) : a ? el("p", { class: "muted", text: a.question_text }) : null,
      el("p", { class: "answer", text: state.pending ? state.pending.text || "…" : a ? a.answer : "Listening…" }),
    ]),
    el("div", { class: "row-btns" }, [
      state.capture === "paused" ? btn("Resume", "", () => void invoke("resume")) : btn("Pause", "", () => void invoke("pause")),
      btn("Stop", "danger", () => void invoke("stop")),
    ]),
    el("div", { class: "card" }, [
      check("Show the answers box", overlayOn, (v) => void showOverlay(v).then(render)),
      overlayOn ? check("Lock the box (clicks go through)", locked, () => void toggleLock(), "Press Ctrl+Shift+L to unlock") : null,
    ]),
  ]);
}

function viewEnded(): HTMLElement[] {
  return [el("div", { class: "card" }, [el("p", { text: "Session ended." }), el("p", { class: "muted", text: "Open the Vren website to review it." })]), btn("Connect a new session", "primary", () => void unpair())];
}

function render() {
  const pills = phase === "live"
    ? [el("span", { class: `pill ${state.connection === "connected" ? "ok" : ""}`, text: state.connection === "connected" ? "Connected" : state.connection === "closed" ? "Offline" : "Reconnecting" }),
       el("span", { class: `pill ${state.capture === "listening" ? "ok" : ""}`, text: state.capture === "listening" ? "Listening" : state.capture === "paused" ? "Paused" : "Starting" })]
    : [];
  const body = phase === "pairing" ? viewPairing() : phase === "ready" ? viewReady() : phase === "live" ? viewLive() : viewEnded();
  root.replaceChildren(el("header", {}, [el("h1", { text: "Vren AI" }), el("div", { class: "row-btns" }, pills)]), el("main", {}, body));
}

interface Wire { kind: "server" | "status"; event?: ServerEvent; status?: string; detail?: string }
void listen<Wire>("vren://event", ({ payload }) => {
  if (payload.kind === "server" && payload.event) {
    state = reduceEvent(state, payload.event);
    if (state.ended) phase = "ended";
  } else if (payload.kind === "status") {
    state = { ...state, connection: (payload.status ?? "idle") as PanelState["connection"] };
    if (payload.status === "closed" && phase === "live") {
      const why = plainReason(payload.detail);
      if (why) state = { ...state, notice: why };
      if (state.ended) phase = "ended";
    }
  }
  void emit("vren://state", state); // the answers box only draws what it is told
  render();
});
void listen("vren://lock", () => { locked = !locked; render(); });

render();
