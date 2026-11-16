// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mountOverlay, OVERLAY_HOST_ID } from "./overlay";
import { emptyState, type LiveAnswer, type OverlayView, type UiMessage } from "./types";

const answer = (over: Partial<LiveAnswer> = {}): LiveAnswer => ({
  id: "a1", question_text: "Why this role?", question_type: "Behavioral", asked_at: "00:10", framework: "Direct",
  answer: "Because I like shipping things.", lines: [], key_points: [], source_label: "Direct answer", caveat: "", ...over,
});
const view = (over: Partial<OverlayView> = {}, state: Partial<OverlayView["state"]> = {}): OverlayView => ({
  phase: "pairing", jobTitle: "", error: "", busy: false, levels: { tab: 0, microphone: 0 }, wantMic: false, wantRoom: false,
  state: { ...emptyState(), ...state }, ...over,
});

function mount() {
  const sent: UiMessage[] = [];
  const onClose = vi.fn();
  const handle = mountOverlay(document, (m) => sent.push(m), onClose);
  const root = () => document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
  const click = (selector: string) => (root().querySelector(selector) as HTMLElement).click();
  const buttonByText = (text: string) => [...root().querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
  return { handle, sent, onClose, root, click, buttonByText, text: () => root().textContent ?? "" };
}

describe("the box on the page", () => {
  it("connects with the 6-digit code, digits only", () => {
    const m = mount();
    m.handle.update(view());
    const input = m.root().querySelector("input.code") as HTMLInputElement;
    input.value = "12a3 456";
    input.dispatchEvent(new Event("input"));
    m.buttonByText("Connect").click();
    expect(m.sent.at(-1)).toEqual({ target: "background", type: "UI_PAIR", code: "123456" });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(m.sent.filter((s) => s.type === "UI_PAIR")).toHaveLength(2);
    m.handle.destroy();
  });

  it("does not let the page see the keys typed into it", () => {
    const m = mount();
    m.handle.update(view());
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    (m.root().querySelector("input.code") as HTMLInputElement).dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, composed: true }));
    document.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
    m.handle.destroy();
  });

  it("keeps what you typed when the box is redrawn", () => {
    const m = mount();
    m.handle.update(view());
    const input = m.root().querySelector("input.code") as HTMLInputElement;
    input.value = "4821";
    input.dispatchEvent(new Event("input"));
    m.handle.update(view({ busy: true })); // a push arrives while typing
    expect((m.root().querySelector("input.code") as HTMLInputElement).value).toBe("4821");
    expect(m.text()).toContain("Connecting…");
    m.handle.destroy();
  });

  it("shows pairing errors in plain words", () => {
    const m = mount();
    m.handle.update(view({ error: "That code is invalid or has expired." }));
    expect(m.root().querySelector("[role=alert]")!.textContent).toBe("That code is invalid or has expired.");
    m.handle.destroy();
  });

  it("is ready to start in one click, with the choices kept short", () => {
    const m = mount();
    m.handle.update(view({ phase: "ready", jobTitle: "Customer Success Manager" }));
    expect(m.text()).toContain("Connected · Customer Success Manager");
    expect(m.text()).toContain("shows if you share this tab"); // honest, one line
    m.click('input[aria-label="Phone or in-person"]');
    expect(m.sent.at(-1)).toEqual({ target: "background", type: "UI_PREFS", mic: false, room: true });
    m.buttonByText("Start").click();
    expect(m.sent.at(-1)).toEqual({ target: "background", type: "UI_START" });
    m.buttonByText("Disconnect").click();
    expect(m.sent.at(-1)).toEqual({ target: "background", type: "UI_UNPAIR" });
    m.handle.update(view({ phase: "ready", wantRoom: true }));
    expect(m.root().querySelector('input[aria-label="Also listen to my voice"]')).toBeNull(); // not needed in room mode
    m.handle.destroy();
  });

  it("shows the sound check for each source, with plain words", () => {
    const m = mount();
    const at = Date.now();
    m.handle.update(view({ phase: "live", wantMic: true, levels: { tab: 70, microphone: 5 } }, {
      connection: "connected", capture: "listening", audioAt: at,
      audio: { tab: { level: 70, state: "ok", text_ago: 1 }, microphone: { level: 5, state: "quiet", text_ago: null } },
    }));
    const words = [...m.root().querySelectorAll(".word")].map((w) => w.textContent);
    expect(words).toEqual(["Transcribing ✓", "Quiet"]);
    expect(m.text()).toContain("Interviewer");
    expect(m.text()).toContain("You");
    expect((m.root().querySelector(".bars i") as HTMLElement).style.width).toBe("70%");
    expect(m.root().querySelector(".word.good")).not.toBeNull();
    m.handle.destroy();
  });

  it("shows only the interviewer meter when the microphone is off, and a warning when text is not coming back", () => {
    const m = mount();
    m.handle.update(view({ phase: "live", levels: { tab: 50, microphone: 0 } }, {
      connection: "connected", capture: "listening", audioAt: Date.now(),
      audio: { tab: { level: 50, state: "problem", text_ago: null } },
    }));
    expect(m.root().querySelectorAll(".meter")).toHaveLength(1);
    expect(m.root().querySelector(".word.bad")!.textContent).toBe("Can't turn it into text");
    m.handle.destroy();
  });

  it("shows the answer, the question, and code", () => {
    const m = mount();
    m.handle.update(view({ phase: "live" }, { connection: "connected", answers: [answer({ code: "def f():\n    pass" }), answer({ id: "a0", question_text: "Earlier?", answer: "Earlier answer." })] }));
    expect(m.text()).toContain("Because I like shipping things.");
    expect(m.text()).toContain("Why this role?");
    expect(m.root().querySelector("pre.code")!.textContent).toContain("def f()");
    expect(m.text()).toContain("Earlier answers (1)");
    m.handle.destroy();
  });

  it("has pause, resume, stop and read-the-screen controls", () => {
    const m = mount();
    m.handle.update(view({ phase: "live" }, { connection: "connected", capture: "listening" }));
    m.buttonByText("Pause").click();
    expect(m.sent.at(-1)).toEqual({ target: "background", type: "UI_CONTROL", action: "PAUSE" });
    m.buttonByText("Stop").click();
    expect(m.sent.at(-1)).toEqual({ target: "background", type: "UI_CONTROL", action: "STOP" });
    m.buttonByText("Read the question on screen").click();
    expect(m.sent.at(-1)).toEqual({ target: "background", type: "UI_SCREEN" });
    m.handle.update(view({ phase: "live" }, { connection: "connected", capture: "paused" }));
    m.buttonByText("Resume").click();
    expect(m.sent.at(-1)).toEqual({ target: "background", type: "UI_CONTROL", action: "RESUME" });
    m.handle.destroy();
  });

  it("offers a new session when it ends", () => {
    const m = mount();
    m.handle.update(view({ phase: "ended" }, { ended: true }));
    expect(m.text()).toContain("Session ended.");
    m.buttonByText("Connect a new session").click();
    expect(m.sent.at(-1)).toEqual({ target: "background", type: "UI_UNPAIR" });
    m.handle.destroy();
  });

  it("renders everything as text, never as markup", () => {
    const m = mount();
    m.handle.update(view({ phase: "live", error: "<img src=x onerror=alert(1)>" }, { connection: "connected", answers: [answer({ answer: "<img src=x onerror=alert(2)>", question_text: "<script>alert(3)</script>" })] }));
    expect(m.root().querySelector("img")).toBeNull();
    expect(m.root().querySelector("script")).toBeNull();
    expect(m.text()).toContain("<img src=x onerror=alert(2)>");
    m.handle.destroy();
  });

  it("can be made small, moved and closed, and is mounted only once", () => {
    const m = mount();
    mountOverlay(document, () => {}, () => {}); // mounting again replaces it, never duplicates
    expect(document.querySelectorAll(`#${OVERLAY_HOST_ID}`)).toHaveLength(1);
    const m2 = mount();
    m2.handle.update(view());
    m2.click('button[aria-label="Make the box small"]');
    expect(m2.root().querySelector(".body")!.className).toContain("min");
    m2.click('button[aria-label="Show the box"]');
    expect(m2.root().querySelector(".body")!.className).not.toContain("min");
    m2.click('button[aria-label="Close"]');
    expect(m2.onClose).toHaveBeenCalled();
    m2.handle.destroy();
    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull();
    m.handle.destroy();
  });
});
