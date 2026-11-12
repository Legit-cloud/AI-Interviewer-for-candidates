// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mountOverlay, OVERLAY_HOST_ID } from "./overlay";
import { describeOverlay } from "./overlay-view";
import { emptyState, type LiveAnswer } from "./types";

const ans: LiveAnswer = {
  id: "a1", question_text: "Why this role?", question_type: "Behavioral", asked_at: "00:10", framework: "Direct",
  answer: "Because I like shipping things.", lines: [], key_points: [], source_label: "Direct answer", caveat: "",
};

describe("on-page overlay", () => {
  it("is labelled, mounted once, click-through in the body, and closable", () => {
    const onClose = vi.fn();
    mountOverlay(document, { onClose, onControl: vi.fn() });
    const h = mountOverlay(document, { onClose, onControl: vi.fn() }); // remounting replaces, never duplicates
    expect(document.querySelectorAll(`#${OVERLAY_HOST_ID}`)).toHaveLength(1);
    const root = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
    expect(root.querySelector(".title")!.textContent).toBe("Vren AI");
    expect(root.querySelector("style")!.textContent).toMatch(/\.body \{[^}]*pointer-events: none/);
    expect(root.querySelector(".box")!.className).toBe("box");
    (root.querySelector('button[aria-label="Close overlay"]') as HTMLElement).click();
    expect(onClose).toHaveBeenCalled();
    h.destroy();
    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull();
  });

  it("has pause and stop controls that follow the session state", () => {
    const onControl = vi.fn();
    const h = mountOverlay(document, { onClose: () => {}, onControl });
    const root = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
    const pause = root.querySelector('button[aria-label="Pause listening"]') as HTMLButtonElement;
    pause.click();
    expect(onControl).toHaveBeenLastCalledWith("PAUSE");
    h.update({ ...emptyState(), capture: "paused" });
    expect(pause.textContent).toBe("Resume");
    pause.click();
    expect(onControl).toHaveBeenLastCalledWith("RESUME");
    (root.querySelector('button[aria-label="Stop the session"]') as HTMLButtonElement).click();
    expect(onControl).toHaveBeenLastCalledWith("STOP");
    h.update({ ...emptyState(), ended: true });
    expect(pause.hidden).toBe(true);
    h.destroy();
  });

  it("renders text only through textContent, never as markup", () => {
    const h = mountOverlay(document, { onClose: () => {}, onControl: () => {} });
    h.update({ ...emptyState(), answers: [{ ...ans, answer: "<img src=x onerror=alert(1)>" }] });
    const root = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".a")!.textContent).toContain("<img");
    h.destroy();
  });

  it("describes pending, ready, unavailable and idle states", () => {
    expect(describeOverlay({ ...emptyState(), pending: { questionId: "q", question: "Q?", text: "" } }).body).toBe("…");
    expect(describeOverlay({ ...emptyState(), answers: [ans] }).body).toMatch(/shipping/);
    expect(describeOverlay({ ...emptyState(), notice: "Answer unavailable" }).body).toMatch(/unavailable/i);
    expect(describeOverlay(emptyState()).body).toMatch(/Listening/);
  });
});
