import { emptyState, type LiveAnswer, type PanelState, type ServerEvent } from "./types";

const MAX_TRANSCRIPT = 40;
const MAX_ANSWERS = 30;

/** Pure reducer: server event in, new panel state out. */
export function reduceEvent(state: PanelState, evt: ServerEvent): PanelState {
  switch (evt.type) {
    case "session.ready":
      return { ...state, ended: false };
    case "capture.state":
      return { ...state, capture: evt["state"] === "paused" ? "paused" : "listening" };
    case "transcript.completed":
      return {
        ...state,
        transcript: [
          ...state.transcript.slice(-(MAX_TRANSCRIPT - 1)),
          {
            id: String(evt["item_id"] ?? evt.event_id),
            speaker: String(evt["speaker"] ?? ""),
            text: String(evt["text"] ?? ""),
            at: String(evt["timestamp"] ?? ""),
          },
        ],
      };
    case "answer.started":
      return {
        ...state,
        notice: "",
        pending: {
          questionId: String(evt["question_id"] ?? ""),
          question: String(evt["question_text"] ?? ""),
          text: "",
        },
      };
    case "answer.delta":
      if (!state.pending || state.pending.questionId !== evt["question_id"]) return state;
      return {
        ...state,
        pending: { ...state.pending, text: state.pending.text + String(evt["delta"] ?? "") },
      };
    case "answer.ready": {
      // The final answer is authoritative: it has passed the server-side claim check.
      const ready = evt["answer"] as LiveAnswer | undefined;
      if (!ready) return state;
      const answers = state.answers.some((a) => a.id === ready.id)
        ? state.answers
        : [ready, ...state.answers].slice(0, MAX_ANSWERS);
      return { ...state, answers, pending: null };
    }
    case "answer.unavailable":
      return {
        ...state,
        pending: null,
        notice: String(evt["message"] ?? "Answer unavailable for this question."),
      };
    case "session.degraded":
      return { ...state, notice: String(evt["message"] ?? "The session is degraded.") };
    case "session.expired":
      return { ...state, ended: true, capture: "idle", notice: "This session reached its time limit." };
    case "session.finalized":
      return { ...state, ended: true, capture: "idle", pending: null };
    default:
      return state;
  }
}

export function resetState(): PanelState {
  return emptyState();
}
