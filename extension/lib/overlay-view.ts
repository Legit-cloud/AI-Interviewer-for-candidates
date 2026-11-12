import type { PanelState } from "./types";

export interface OverlayContent {
  heading: string;
  body: string;
  meta: string;
}

/** What the on-page overlay shows for a given panel state. Pure, so it can be tested. */
export function describeOverlay(state: PanelState): OverlayContent {
  if (state.pending) {
    return { heading: state.pending.question, body: state.pending.text || "…", meta: "Answering" };
  }
  const latest = state.answers[0];
  if (latest) {
    return {
      heading: latest.question_text,
      body: latest.answer,
      meta: latest.caveat ? `${latest.source_label} · ${latest.caveat}` : latest.source_label,
    };
  }
  if (state.ended) return { heading: "", body: "Session ended.", meta: "" };
  if (state.notice) return { heading: "", body: state.notice, meta: "" };
  return { heading: "", body: "Listening for questions…", meta: state.capture === "paused" ? "Paused" : "" };
}
