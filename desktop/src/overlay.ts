import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { describeOverlay } from "../../extension/lib/overlay-view";
import { emptyState, type PanelState } from "../../extension/lib/types";
import "./style.css";

// The answers box. It only draws the state the control window sends. Dragging uses the window's own drag region.
const root = document.getElementById("app") as HTMLElement;
let state: PanelState = emptyState();
let size = 16;
let opacity = 0.85;
let locked = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function button(label: string, aria: string, on: () => void) {
  const b = el("button", "", label);
  b.setAttribute("aria-label", aria);
  b.addEventListener("click", on);
  return b;
}

function render() {
  const c = describeOverlay(state);
  const box = el("div", "box");
  box.style.setProperty("--size", `${size}px`);
  box.style.setProperty("--op", String(opacity));

  const bar = el("div", "bar");
  bar.setAttribute("data-tauri-drag-region", "");
  const title = el("span", "title", "Vren AI");
  title.setAttribute("data-tauri-drag-region", "");
  bar.append(
    title,
    button("A−", "Smaller text", () => { size = Math.max(12, size - 1); render(); }),
    button("A+", "Larger text", () => { size = Math.min(30, size + 1); render(); }),
    button("◐", "Change transparency", () => { opacity = opacity <= 0.5 ? 0.95 : opacity - 0.15; render(); }),
    button("Lock", "Lock the box so clicks go through", () => void invoke("overlay_lock", { locked: true }).then(() => { locked = true; render(); })),
    button("×", "Hide the box", () => void invoke("overlay_hide")),
  );
  box.append(bar);
  if (locked) box.append(el("div", "locked-note", "Locked. Press Ctrl+Shift+L to move it."));

  const body = el("div", "body");
  if (c.heading) body.append(el("p", "q", c.heading));
  body.append(el("p", "a", c.body));
  const code = state.answers[0]?.code;
  if (code && !state.pending) body.append(el("pre", "", code));
  if (c.meta) body.append(el("p", "m", c.meta));
  box.append(body);
  root.replaceChildren(box);
}

void listen<PanelState>("vren://state", ({ payload }) => { state = payload; render(); });
void listen<boolean>("vren://locked", ({ payload }) => { locked = payload; render(); });
void getCurrentWindow().setTitle("Vren AI answers");
render();
