import { describeOverlay } from "./overlay-view";
import type { PanelState } from "./types";

export const OVERLAY_HOST_ID = "vren-ai-overlay";

const CSS = `
:host { all: initial; }
.box { position: fixed; top: 64px; right: 24px; width: 380px; max-width: calc(100vw - 16px);
  z-index: 2147483647; font: 14px/1.5 system-ui, sans-serif; color: #fff;
  background: rgba(16, 26, 23, var(--op, 0.82)); border: 1px solid rgba(255,255,255,.18);
  border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.35); }
.bar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: grab; user-select: none;
  border-bottom: 1px solid rgba(255,255,255,.14); font-size: 12px; }
.bar.drag { cursor: grabbing; }
.title { flex: 1; font-weight: 600; }
.bar button { all: unset; cursor: pointer; padding: 1px 7px; border-radius: 6px; border: 1px solid rgba(255,255,255,.25); }
.bar button:hover { background: rgba(255,255,255,.14); }
/* The text area lets clicks pass through to the page behind it. */
.body { padding: 10px 12px 12px; pointer-events: none; }
.q { margin: 0 0 6px; font-size: 12px; opacity: .72; }
.a { margin: 0; font-size: var(--size, 16px); white-space: pre-wrap; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
.m { margin: 8px 0 0; font: 11px ui-monospace, monospace; opacity: .65; }
`;

export interface OverlayHandle {
  update: (state: PanelState) => void;
  destroy: () => void;
}

/**
 * Mounts the visible on-page overlay. It is labelled as Vren AI, can be dragged by its top bar, resized
 * text-wise, dimmed, and closed. Its text area is click-through. Text is only ever set via textContent.
 */
export function mountOverlay(doc: Document, onClose: () => void): OverlayHandle {
  doc.getElementById(OVERLAY_HOST_ID)?.remove();
  const host = doc.createElement("div");
  host.id = OVERLAY_HOST_ID;
  const root = host.attachShadow({ mode: "open" });

  const style = doc.createElement("style");
  style.textContent = CSS;
  const box = doc.createElement("div");
  box.className = "box";

  const bar = doc.createElement("div");
  bar.className = "bar";
  const title = doc.createElement("span");
  title.className = "title";
  title.textContent = "Vren AI · on-page overlay";
  const mk = (label: string, aria: string, fn: () => void) => {
    const b = doc.createElement("button");
    b.textContent = label;
    b.setAttribute("aria-label", aria);
    b.addEventListener("click", fn);
    return b;
  };
  let size = 16;
  let opacity = 0.82;
  const apply = () => {
    box.style.setProperty("--size", `${size}px`);
    box.style.setProperty("--op", String(opacity));
  };
  bar.append(
    title,
    mk("A−", "Smaller text", () => ((size = Math.max(12, size - 1)), apply())),
    mk("A+", "Larger text", () => ((size = Math.min(28, size + 1)), apply())),
    mk("◐", "Change transparency", () => ((opacity = opacity <= 0.5 ? 0.95 : opacity - 0.15), apply())),
    mk("×", "Close overlay", onClose),
  );

  const body = doc.createElement("div");
  body.className = "body";
  const q = doc.createElement("p");
  q.className = "q";
  const a = doc.createElement("p");
  a.className = "a";
  const m = doc.createElement("p");
  m.className = "m";
  body.append(q, a, m);
  box.append(bar, body);
  root.append(style, box);
  (doc.body ?? doc.documentElement).append(host);

  // Dragging: only the top bar takes pointer events.
  let drag: { dx: number; dy: number } | null = null;
  bar.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    const rect = box.getBoundingClientRect();
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    bar.classList.add("drag");
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  });
  bar.addEventListener("pointermove", (e) => {
    if (!drag) return;
    box.style.left = `${Math.max(0, e.clientX - drag.dx)}px`;
    box.style.top = `${Math.max(0, e.clientY - drag.dy)}px`;
    box.style.right = "auto";
  });
  const end = () => {
    drag = null;
    bar.classList.remove("drag");
  };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);

  apply();
  return {
    update: (state) => {
      const c = describeOverlay(state);
      q.textContent = c.heading;
      q.hidden = !c.heading;
      a.textContent = c.body;
      m.textContent = c.meta;
      m.hidden = !c.meta;
    },
    destroy: () => host.remove(),
  };
}
