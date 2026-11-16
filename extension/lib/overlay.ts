import { describeOverlay } from "./overlay-view";
import { readMeter, SOURCE_NAME, visibleSources } from "./overlay-model";
import type { OverlayView, UiMessage } from "./types";

export const OVERLAY_HOST_ID = "vren-ai-overlay";

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.box { position: fixed; top: 64px; right: 24px; width: 340px; max-width: calc(100vw - 16px); max-height: 82vh; display: flex; flex-direction: column;
  z-index: 2147483647; font: 14px/1.45 system-ui, sans-serif; color: #fff; background: rgba(16, 26, 23, var(--op, 0.92));
  border: 1px solid rgba(255,255,255,.18); border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.35); overflow: hidden; }
.bar { display: flex; align-items: center; gap: 6px; padding: 7px 9px; cursor: grab; user-select: none; border-bottom: 1px solid rgba(255,255,255,.14); font-size: 12px; }
.bar.drag { cursor: grabbing; }
.title { flex: 1; font-weight: 600; }
.bar button { all: unset; cursor: pointer; padding: 1px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,.25); }
.bar button:hover { background: rgba(255,255,255,.14); }
.body { padding: 12px; overflow: auto; display: grid; gap: 10px; }
.body.min { display: none; }
p { margin: 0; }
.muted { opacity: .72; font-size: 12.5px; }
.err { color: #ffb4b4; font-size: 13px; }
input.code { width: 100%; font: 22px ui-monospace, monospace; letter-spacing: .35em; text-align: center; padding: 9px; border-radius: 8px; border: 1px solid rgba(255,255,255,.3); background: rgba(255,255,255,.08); color: #fff; }
input.code::placeholder { color: rgba(255,255,255,.35); }
label.opt { display: flex; gap: 9px; align-items: flex-start; cursor: pointer; }
label.opt input { margin-top: 3px; width: 17px; height: 17px; }
label.opt small { display: block; opacity: .65; font-size: 12px; }
button.btn { font: inherit; border-radius: 8px; border: 1px solid rgba(255,255,255,.3); background: rgba(255,255,255,.1); color: #fff; padding: 8px 12px; cursor: pointer; }
button.btn:hover { background: rgba(255,255,255,.18); }
button.btn.primary { background: #3c9a7a; border-color: #3c9a7a; font-weight: 600; padding: 10px 12px; }
button.btn.danger { border-color: #e08a8a; color: #ffc4c4; }
button.btn:disabled { opacity: .5; cursor: not-allowed; }
button.link { all: unset; cursor: pointer; text-decoration: underline; opacity: .7; font-size: 12.5px; }
.row { display: flex; gap: 8px; }
.row > .btn { flex: 1; }
.sound { display: grid; gap: 6px; padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,.07); }
.meter { display: grid; grid-template-columns: 74px 1fr; gap: 8px; align-items: center; font-size: 12px; }
.bars { height: 6px; border-radius: 3px; background: rgba(255,255,255,.15); overflow: hidden; }
.bars > i { display: block; height: 100%; width: 0; background: #7bd1b0; transition: width .15s linear; }
.word { grid-column: 1 / -1; font-size: 12px; margin-top: -2px; }
.word.good { color: #8be0bf; } .word.wait { color: #f0d28a; } .word.bad { color: #ffb4b4; }
.q { font-size: 12px; opacity: .72; margin-bottom: 4px; }
.a { font-size: var(--size, 16px); white-space: pre-wrap; text-shadow: 0 1px 2px rgba(0,0,0,.6); pointer-events: none; }
pre.code { margin: 6px 0 0; padding: 8px; background: rgba(255,255,255,.08); border-radius: 6px; font: 12px/1.4 ui-monospace, monospace; overflow: auto; }
details summary { cursor: pointer; font-size: 12.5px; opacity: .75; }
details .earlier { margin-top: 8px; display: grid; gap: 10px; }
`;

export interface OverlayHandle {
  update: (view: OverlayView) => void;
  destroy: () => void;
}

type Props = { class?: string; text?: string; attrs?: Record<string, string>; on?: Record<string, (e: Event) => void> };

/**
 * The whole extension UI: a small box on the page. It handles connecting, starting, the live answers and the
 * sound check. It only draws what it is given and reports what the person did; it holds no logic of its own.
 * Every piece of text is set with textContent, so nothing from the server can become markup.
 */
export function mountOverlay(doc: Document, send: (msg: UiMessage) => void, onClose: () => void): OverlayHandle {
  doc.getElementById(OVERLAY_HOST_ID)?.remove();
  const host = doc.createElement("div");
  host.id = OVERLAY_HOST_ID;
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = CSS;
  const box = doc.createElement("div");
  box.className = "box";
  root.append(style, box);
  (doc.body ?? doc.documentElement).append(host);

  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, p: Props = {}, kids: (Node | null)[] = []): HTMLElementTagNameMap[K] => {
    const n = doc.createElement(tag);
    if (p.class) n.className = p.class;
    if (p.text !== undefined) n.textContent = p.text;
    for (const [k, v] of Object.entries(p.attrs ?? {})) n.setAttribute(k, v);
    for (const [k, fn] of Object.entries(p.on ?? {})) n.addEventListener(k, fn);
    for (const c of kids) if (c) n.append(c);
    return n;
  };
  const btn = (label: string, cls: string, on: () => void, disabled = false) => {
    const b = h("button", { class: `btn ${cls}`.trim(), text: label, on: { click: on } });
    b.disabled = disabled;
    return b;
  };

  const compact = (nodes: (HTMLElement | null)[]): HTMLElement[] => nodes.filter((n): n is HTMLElement => n !== null);
  let view: OverlayView | null = null;
  let size = 16;
  let minimized = false;
  let codeValue = "";
  let timer: ReturnType<typeof setInterval> | undefined;

  // The page must not see the keys typed into the box (a meeting page has its own shortcuts).
  const keep = (e: Event) => e.stopPropagation();

  function bar(): HTMLElement {
    const b = h("div", { class: "bar" });
    b.append(
      h("span", { class: "title", text: "Vren AI" }),
      ...(view?.phase === "live"
        ? [
            h("button", { text: "A−", attrs: { "aria-label": "Smaller text" }, on: { click: () => ((size = Math.max(12, size - 1)), render()) } }),
            h("button", { text: "A+", attrs: { "aria-label": "Larger text" }, on: { click: () => ((size = Math.min(28, size + 1)), render()) } }),
          ]
        : []),
      h("button", { text: minimized ? "▢" : "–", attrs: { "aria-label": minimized ? "Show the box" : "Make the box small" }, on: { click: () => ((minimized = !minimized), render()) } }),
      h("button", { text: "×", attrs: { "aria-label": "Close" }, on: { click: onClose } }),
    );
    // dragging
    let drag: { dx: number; dy: number } | null = null;
    b.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      const r = box.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      b.classList.add("drag");
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    });
    b.addEventListener("pointermove", (e) => {
      if (!drag) return;
      box.style.left = `${Math.max(0, e.clientX - drag.dx)}px`;
      box.style.top = `${Math.max(0, e.clientY - drag.dy)}px`;
      box.style.right = "auto";
    });
    const end = () => {
      drag = null;
      b.classList.remove("drag");
    };
    b.addEventListener("pointerup", end);
    b.addEventListener("pointercancel", end);
    return b;
  }

  function pairing(v: OverlayView): HTMLElement[] {
    const input = h("input", { class: "code", attrs: { type: "text", inputmode: "numeric", maxlength: "6", placeholder: "000000", "aria-label": "6-digit code", autocomplete: "off", id: "vren-code" } });
    (input as HTMLInputElement).value = codeValue;
    input.addEventListener("input", () => (codeValue = (input as HTMLInputElement).value.replace(/\D/g, "")));
    const go = () => send({ target: "background", type: "UI_PAIR", code: codeValue });
    for (const t of ["keydown", "keyup", "keypress"]) input.addEventListener(t, keep);
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") go();
    });
    return compact([
      h("p", { text: "Enter the code from the Vren website." }),
      input,
      btn(v.busy ? "Connecting…" : "Connect", "primary", go, v.busy),
      v.error ? h("p", { class: "err", text: v.error, attrs: { role: "alert" } }) : null,
    ]);
  }

  function option(label: string, hint: string, on: boolean, change: (v: boolean) => void): HTMLElement {
    const box_ = h("input", { attrs: { type: "checkbox", "aria-label": label } });
    (box_ as HTMLInputElement).checked = on;
    box_.addEventListener("change", () => change((box_ as HTMLInputElement).checked));
    return h("label", { class: "opt" }, [box_, h("span", {}, [h("span", { text: label }), hint ? h("small", { text: hint }) : null])]);
  }

  function ready(v: OverlayView): HTMLElement[] {
    return compact([
      h("p", { text: v.jobTitle ? `Connected · ${v.jobTitle}` : "Connected" }),
      option("Phone or in-person", "Uses your microphone to hear the room", v.wantRoom, (room) => send({ target: "background", type: "UI_PREFS", mic: v.wantMic, room })),
      v.wantRoom ? null : option("Also listen to my voice", "", v.wantMic, (mic) => send({ target: "background", type: "UI_PREFS", mic, room: v.wantRoom })),
      v.error ? h("p", { class: "err", text: v.error, attrs: { role: "alert" } }) : null,
      btn(v.busy ? "Starting…" : "Start", "primary", () => send({ target: "background", type: "UI_START" }), v.busy),
      h("p", { class: "muted", text: "This box is part of the page, so it shows if you share this tab." }),
      h("button", { class: "link", text: "Disconnect", on: { click: () => send({ target: "background", type: "UI_UNPAIR" }) } }),
    ]);
  }

  function sound(v: OverlayView): HTMLElement {
    const now = Date.now();
    const rows = visibleSources(v).map((src) => {
      const m = readMeter(src, v, now);
      const fill = h("i");
      fill.style.width = `${m.level}%`;
      return h("div", {}, [
        h("div", { class: "meter" }, [h("span", { text: v.wantRoom && src === "microphone" ? "Room" : SOURCE_NAME[src] }), h("div", { class: "bars" }, [fill])]),
        h("p", { class: `word ${m.tone}`, text: m.label, attrs: { role: "status" } }),
      ]);
    });
    return h("div", { class: "sound", attrs: { "aria-label": "Sound check" } }, rows);
  }

  function live(v: OverlayView): HTMLElement[] {
    const c = describeOverlay(v.state);
    const latest = v.state.answers[0];
    const earlier = v.state.answers.slice(1);
    const answer = h("div", {}, [
      c.heading ? h("p", { class: "q", text: c.heading }) : null,
      h("p", { class: "a", text: c.body }),
      latest?.code && !v.state.pending ? h("pre", { class: "code", text: latest.code }) : null,
      c.meta ? h("p", { class: "muted", text: c.meta }) : null,
    ]);
    answer.style.setProperty("--size", `${size}px`);
    return compact([
      sound(v),
      answer,
      earlier.length
        ? h("details", {}, [h("summary", { text: `Earlier answers (${earlier.length})` }), h("div", { class: "earlier" }, earlier.map((a) => h("div", {}, [h("p", { class: "q", text: a.question_text }), h("p", { text: a.answer })])))])
        : null,
      h("div", { class: "row" }, [
        v.state.capture === "paused"
          ? btn("Resume", "", () => send({ target: "background", type: "UI_CONTROL", action: "RESUME" }))
          : btn("Pause", "", () => send({ target: "background", type: "UI_CONTROL", action: "PAUSE" })),
        btn("Stop", "danger", () => send({ target: "background", type: "UI_CONTROL", action: "STOP" })),
      ]),
      h("button", { class: "link", text: "Read the question on screen", on: { click: () => send({ target: "background", type: "UI_SCREEN" }) } }),
      v.error ? h("p", { class: "err", text: v.error, attrs: { role: "alert" } }) : null,
    ]);
  }

  function ended(): HTMLElement[] {
    return [
      h("p", { text: "Session ended." }),
      h("p", { class: "muted", text: "Open the Vren website to review it." }),
      btn("Connect a new session", "primary", () => send({ target: "background", type: "UI_UNPAIR" })),
    ];
  }

  function render(): void {
    if (!view) return;
    const typing = (root.activeElement as HTMLElement | null)?.id === "vren-code";
    const body = h("div", { class: `body${minimized ? " min" : ""}` }, view.phase === "pairing" ? pairing(view) : view.phase === "ready" ? ready(view) : view.phase === "live" ? live(view) : ended());
    box.replaceChildren(bar(), body);
    if (typing) (root.getElementById("vren-code") as HTMLInputElement | null)?.focus();
    // The meters need to notice that reports stopped, even if nothing else changes.
    clearInterval(timer);
    if (view.phase === "live") timer = setInterval(render, 2000);
  }

  return {
    update: (next) => {
      view = next;
      render();
    },
    destroy: () => {
      clearInterval(timer);
      host.remove();
    },
  };
}
