import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { float32ToPcm16, pcm16ToBase64 } from "../lib/audio-buffer";
import type {
  InterviewType,
  OffscreenLiveEvent,
  WidgetPublicSnapshot,
  WidgetUiState,
} from "../lib/types";

const INTERVIEW_TYPES: InterviewType[] = [
  "Mixed",
  "Behavioural",
  "Technical",
  "System Design",
  "Case / Portfolio",
];

const WIDGET_CSS = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
    color: #121A18;
    -webkit-font-smoothing: antialiased;
  }
  *, *::before, *::after {
    box-sizing: border-box;
  }
  .vren-anchor {
    position: fixed;
    z-index: 2147483647;
    user-select: none;
  }
  .vren-orb {
    width: 48px;
    height: 48px;
    border-radius: 9999px;
    background: #0F2A26;
    color: #F5F3EE;
    border: 2px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 10px 28px rgba(15, 42, 38, 0.32), 0 2px 6px rgba(18, 26, 24, 0.14);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    position: relative;
    font-weight: 700;
    font-size: 16px;
    letter-spacing: -0.02em;
    transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
  }
  .vren-orb:hover {
    transform: scale(1.06);
    background: #0F5E54;
    box-shadow: 0 14px 32px rgba(15, 42, 38, 0.38);
  }
  .vren-orb:active {
    cursor: grabbing;
  }
  .vren-orb:focus-visible,
  .vren-card button:focus-visible,
  .vren-card input:focus-visible,
  .vren-card select:focus-visible {
    outline: 2px solid #0F5E54;
    outline-offset: 2px;
  }
  .vren-orb-dot {
    position: absolute;
    top: 0;
    right: 0;
    width: 12px;
    height: 12px;
    border-radius: 9999px;
    border: 2px solid #FFFFFF;
  }
  .vren-card {
    position: relative;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    background: #F5F3EE;
    color: #121A18;
    border: 1px solid #D8D2C5;
    border-radius: 16px;
    box-shadow: 0 20px 50px rgba(15, 42, 38, 0.22), 0 4px 12px rgba(18, 26, 24, 0.08);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-size: 13px;
    line-height: 1.5;
  }
  .vren-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 14px;
    background: #FFFFFF;
    border-bottom: 1px solid #E5E0D5;
    cursor: grab;
    flex-shrink: 0;
  }
  .vren-header:active {
    cursor: grabbing;
  }
  .vren-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 13.5px;
    color: #121A18;
    min-width: 0;
  }
  .vren-logo {
    width: 24px;
    height: 24px;
    border-radius: 7px;
    background: #0F2A26;
    color: #F5F3EE;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .vren-h-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .vren-size-pills {
    display: inline-flex;
    align-items: center;
    background: #F5F3EE;
    border: 1px solid #DED8CA;
    border-radius: 7px;
    padding: 2px;
    gap: 1px;
  }
  .vren-size-btn {
    border: 0;
    background: transparent;
    color: #4A5652;
    font-size: 10.5px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 5px;
    cursor: pointer;
    line-height: 1.3;
  }
  .vren-size-btn:hover {
    color: #121A18;
  }
  .vren-size-btn.active {
    background: #FFFFFF;
    color: #0F5E54;
    box-shadow: 0 1px 2px rgba(18, 26, 24, 0.08);
  }
  .vren-icon-btn {
    border: 1px solid #DED8CA;
    background: #FFFFFF;
    color: #121A18;
    border-radius: 7px;
    padding: 4px 8px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    transition: background 0.14s ease, border-color 0.14s ease;
  }
  .vren-icon-btn:hover {
    background: #F5F3EE;
    border-color: #C9C1B0;
  }
  .vren-context-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 14px;
    background: #FAF8F3;
    border-bottom: 1px solid #E5E0D5;
    font-size: 11.5px;
    color: #3E4A46;
    flex-shrink: 0;
  }
  .vren-context-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }
  .vren-context-role {
    font-weight: 600;
    color: #121A18;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vren-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #E3EEE9;
    color: #0F5E54;
    border-radius: 9999px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .vren-chip-neutral {
    background: #ECE8DE;
    color: #3E4A46;
  }
  .vren-body {
    flex: 1;
    min-height: 0;
    padding: 14px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    user-select: text;
  }
  .vren-panel {
    background: #FFFFFF;
    border: 1px solid #E2DDD0;
    border-radius: 12px;
    padding: 13px 14px;
    box-shadow: 0 1px 2px rgba(18, 26, 24, 0.04);
  }
  .vren-section-label {
    display: block;
    font-size: 11.5px;
    font-weight: 600;
    color: #495450;
    margin-bottom: 5px;
  }
  .vren-muted {
    color: #495450;
    font-size: 12px;
  }
  .vren-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .vren-btn-primary {
    width: 100%;
    border: 0;
    border-radius: 10px;
    background: #0F5E54;
    color: #FFFFFF;
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
    flex-shrink: 0;
  }
  .vren-btn-primary:hover:not(:disabled) {
    background: #0B4A42;
  }
  .vren-btn-primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .vren-btn-outline {
    border: 1px solid #D5CEC0;
    background: #FFFFFF;
    color: #121A18;
    border-radius: 9px;
    padding: 8px 12px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.14s ease, border-color 0.14s ease;
  }
  .vren-btn-outline:hover {
    background: #FAF8F3;
    border-color: #BEB5A3;
  }
  .vren-btn-danger {
    border: 0;
    border-radius: 7px;
    background: #A92B2B;
    color: #FFFFFF;
    padding: 4px 10px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .vren-btn-danger:hover {
    background: #8E2222;
  }
  .vren-input, .vren-select {
    width: 100%;
    border: 1px solid #D5CEC0;
    background: #FFFFFF;
    color: #121A18;
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 12.5px;
    line-height: 1.4;
    outline: none;
  }
  .vren-input:focus, .vren-select:focus {
    border-color: #0F5E54;
  }
  .vren-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .vren-switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 0;
    cursor: pointer;
    font-size: 12.5px;
    color: #121A18;
  }
  .vren-switch-input {
    appearance: none;
    -webkit-appearance: none;
    width: 34px;
    height: 20px;
    border-radius: 9999px;
    background: #D5CEC0;
    position: relative;
    cursor: pointer;
    transition: background 0.16s ease;
    flex-shrink: 0;
    margin: 0;
  }
  .vren-switch-input::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: #FFFFFF;
    box-shadow: 0 1px 2px rgba(18, 26, 24, 0.22);
    transition: transform 0.16s ease;
  }
  .vren-switch-input:checked {
    background: #0F5E54;
  }
  .vren-switch-input:checked::after {
    transform: translateX(14px);
  }
  .vren-answer-card {
    background: #FFFFFF;
    border: 1px solid #DFDAD0;
    border-left: 3px solid #0F5E54;
    border-radius: 12px;
    padding: 14px 15px;
    box-shadow: 0 1px 3px rgba(18, 26, 24, 0.05);
  }
  .vren-question-title {
    display: block;
    font-size: 13.5px;
    font-weight: 600;
    color: #121A18;
    margin-top: 6px;
    line-height: 1.4;
  }
  .vren-bullets {
    margin: 10px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .vren-bullets li {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    font-size: 13.5px;
    line-height: 1.55;
    color: #121A18;
  }
  .vren-bullet-dot {
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: #0F5E54;
    margin-top: 8px;
    flex-shrink: 0;
  }
  .vren-stream-text {
    margin: 10px 0 0;
    white-space: pre-line;
    font-size: 13.5px;
    line-height: 1.55;
    color: #121A18;
  }
  .vren-evidence {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #EFEAE0;
    font-size: 11.5px;
    color: #495450;
  }
  .vren-transcript {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .vren-turn {
    padding: 9px 11px;
    border-radius: 9px;
    background: #FAF8F3;
    border: 1px solid #EAE4D7;
    font-size: 12.5px;
    line-height: 1.48;
  }
  .vren-turn.is-user {
    background: #F0F6F4;
    border-color: #D2E3DD;
  }
  .vren-err {
    color: #9F2D2D;
    background: #FDECEC;
    border: 1px solid #F5C6C6;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
    margin: 0;
    line-height: 1.4;
  }
  .vren-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    background: #EFEAE0;
    padding: 3px;
    border-radius: 9px;
  }
  .vren-tab {
    border: 0;
    background: transparent;
    color: #495450;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 8px;
    border-radius: 7px;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease;
  }
  .vren-tab.active {
    background: #FFFFFF;
    color: #121A18;
    box-shadow: 0 1px 2px rgba(18, 26, 24, 0.08);
  }
  .vren-footer-ask {
    padding: 10px 14px;
    background: #FFFFFF;
    border-top: 1px solid #E5E0D5;
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
  }
  .vren-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 600;
    color: #0F5E54;
    background: #E3EEE9;
    padding: 2px 7px;
    border-radius: 9999px;
  }
  .vren-live-dot {
    width: 7px;
    height: 7px;
    border-radius: 9999px;
  }
  .vren-resize-se {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 18px;
    height: 18px;
    cursor: nwse-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #7D8580;
    z-index: 4;
  }
  .vren-resize-se:hover {
    color: #0F5E54;
  }
  .vren-resize-sw {
    position: absolute;
    left: 2px;
    bottom: 2px;
    width: 16px;
    height: 16px;
    cursor: nesw-resize;
    z-index: 4;
  }
  .vren-resize-e {
    position: absolute;
    right: 0;
    top: 44px;
    bottom: 18px;
    width: 6px;
    cursor: ew-resize;
    z-index: 3;
  }
  .vren-resize-w {
    position: absolute;
    left: 0;
    top: 44px;
    bottom: 18px;
    width: 6px;
    cursor: ew-resize;
    z-index: 3;
  }
  .vren-resize-s {
    position: absolute;
    left: 18px;
    right: 18px;
    bottom: 0;
    height: 6px;
    cursor: ns-resize;
    z-index: 3;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      transition: none !important;
      animation: none !important;
    }
  }
`;

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function sendBg<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve((res ?? {}) as T);
    });
  });
}

const SIZE_PRESETS = [
  { key: "S", label: "Compact (320x360)", width: 320, height: 360 },
  { key: "M", label: "Standard (380x480)", width: 380, height: 480 },
  { key: "L", label: "Expanded (460x600)", width: 460, height: 600 },
] as const;

function clampSize(width: number, height: number): { width: number; height: number } {
  const maxW = Math.max(300, Math.min(680, window.innerWidth - 16));
  const maxH = Math.max(260, Math.min(780, window.innerHeight - 16));
  return {
    width: Math.round(Math.min(Math.max(300, width), maxW)),
    height: Math.round(Math.min(Math.max(260, height), maxH)),
  };
}

function clampCoords(
  x: number,
  y: number,
  expanded: boolean,
  cardWidth?: number,
  cardHeight?: number,
): { x: number; y: number } {
  const w = expanded ? Math.min(cardWidth ?? 380, window.innerWidth - 16) : 48;
  const h = expanded ? Math.min(cardHeight ?? 480, window.innerHeight - 16) : 48;
  const maxX = Math.max(8, window.innerWidth - w - 8);
  const maxY = Math.max(8, window.innerHeight - h - 8);
  return {
    x: Math.min(Math.max(8, x), maxX),
    y: Math.min(Math.max(8, y), maxY),
  };
}

function FloatingWidgetApp() {
  const [ui, setUi] = useState<WidgetUiState>({
    x: Math.max(12, window.innerWidth - 68),
    y: Math.max(12, window.innerHeight - 100),
    width: 380,
    height: 480,
    expanded: false,
    hidden: false,
  });
  const [snap, setSnap] = useState<WidgetPublicSnapshot | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [authTab, setAuthTab] = useState<"signin" | "code">("signin");
  const [liveTab, setLiveTab] = useState<"answer" | "transcript">("answer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stealthMasked, setStealthMasked] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [quickQuestion, setQuickQuestion] = useState("");

  const cardRef = useRef<HTMLElement | null>(null);
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const uiInitializedRef = useRef(false);
  const uiSeqRef = useRef(0);
  const displayCaptureRef = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    port: chrome.runtime.Port;
    cleanup: () => void;
  } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const resizeRef = useRef<{
    dir: "se" | "sw" | "e" | "w" | "s";
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
    lastX: number;
    lastW: number;
    lastH: number;
  } | null>(null);

  const hydrate = useCallback(async (checkHealth = true) => {
    const seqAtStart = uiSeqRef.current;
    try {
      const res = await sendBg<{
        ok?: boolean;
        snapshot?: WidgetPublicSnapshot;
        ui?: WidgetUiState;
      }>({ type: "WIDGET_GET_STATE", checkHealth });
      if (res.snapshot) {
        setSnap(res.snapshot);
        if (res.snapshot.startedAt && (res.snapshot.stage === "live" || res.snapshot.stage === "degraded")) {
          const startedMs = new Date(res.snapshot.startedAt).getTime();
          setElapsedSec(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
        }
      }
      if (res.ui && !uiInitializedRef.current && seqAtStart === uiSeqRef.current) {
        uiInitializedRef.current = true;
        const size = clampSize(res.ui.width ?? 380, res.ui.height ?? 480);
        const defaultX = Math.max(12, window.innerWidth - (res.ui.expanded ? size.width + 16 : 68));
        const defaultY = Math.max(12, window.innerHeight - (res.ui.expanded ? size.height + 16 : 100));
        const clamped = clampCoords(
          res.ui.x >= 0 ? res.ui.x : defaultX,
          res.ui.y >= 0 ? res.ui.y : defaultY,
          res.ui.expanded,
          size.width,
          size.height,
        );
        setUi({
          ...res.ui,
          x: clamped.x,
          y: clamped.y,
          width: size.width,
          height: size.height,
        });
      }
    } catch {
      // Ignore if service worker is waking up.
    }
  }, []);

  useEffect(() => {
    void hydrate(false).then(() => hydrate(true));
    const onResize = () => {
      setUi((prev) => {
        const size = clampSize(prev.width, prev.height);
        const clamped = clampCoords(prev.x, prev.y, prev.expanded, size.width, size.height);
        return { ...prev, x: clamped.x, y: clamped.y, width: size.width, height: size.height };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [hydrate]);

  useEffect(() => {
    if (!ui.expanded || !cardRef.current) return;
    const el = cardRef.current;
    const clampToCard = () => {
      if (dragRef.current || resizeRef.current) return;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) return;
      setUi((prev) => {
        if (!prev.expanded) return prev;
        const clamped = clampCoords(prev.x, prev.y, true, rect.width, rect.height);
        if (Math.abs(clamped.x - prev.x) < 1 && Math.abs(clamped.y - prev.y) < 1) {
          return prev;
        }
        return { ...prev, x: clamped.x, y: clamped.y };
      });
    };
    clampToCard();
    const ro = new ResizeObserver(clampToCard);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ui.expanded, ui.width, ui.height]);

  useEffect(() => {
    const onMessage = (message: Record<string, unknown>) => {
      if (!message || message.target !== "vren-widget") return;

      if (message.type === "WIDGET_UI_CHANGED" && message.ui) {
        if (dragRef.current || resizeRef.current) return;
        uiInitializedRef.current = true;
        uiSeqRef.current += 1;
        const nextUi = message.ui as WidgetUiState;
        const size = clampSize(nextUi.width ?? uiRef.current.width, nextUi.height ?? uiRef.current.height);
        const defaultX = Math.max(12, window.innerWidth - (nextUi.expanded ? size.width + 16 : 68));
        const defaultY = Math.max(12, window.innerHeight - (nextUi.expanded ? size.height + 16 : 100));
        const clamped = clampCoords(
          nextUi.x >= 0 ? nextUi.x : defaultX,
          nextUi.y >= 0 ? nextUi.y : defaultY,
          nextUi.expanded,
          size.width,
          size.height,
        );
        setUi({ ...nextUi, x: clamped.x, y: clamped.y, width: size.width, height: size.height });
        return;
      }

      if (message.type === "WIDGET_PUBLIC_SNAPSHOT" && message.snapshot) {
        setSnap(message.snapshot as WidgetPublicSnapshot);
        return;
      }

      if (message.type === "WIDGET_LIVE_EVENT" && message.event) {
        const evt = message.event as OffscreenLiveEvent;
        setSnap((prev) => {
          if (!prev) return prev;
          if (evt.type === "LIVE_CONNECTED") {
            return {
              ...prev,
              sttMode: evt.sttMode,
              liveStatus: prev.liveStatus === "paused" ? "paused" : "listening",
              degradedMessage: null,
              stage: prev.stage === "degraded" ? "live" : prev.stage,
            };
          }
          if (evt.type === "LIVE_TRANSCRIPT") {
            return { ...prev, transcript: [...prev.transcript.slice(-24), evt.item] };
          }
          if (evt.type === "LIVE_QUESTION") {
            return { ...prev, detectedQuestion: evt.text };
          }
          if (evt.type === "LIVE_SUGGESTION_STARTED") {
            return {
              ...prev,
              streamingText: "",
              detectedQuestion: evt.questionText || prev.detectedQuestion,
            };
          }
          if (evt.type === "LIVE_SUGGESTION_DELTA") {
            return { ...prev, streamingText: `${prev.streamingText}${evt.delta}` };
          }
          if (evt.type === "LIVE_SUGGESTION") {
            return {
              ...prev,
              detectedQuestion: null,
              streamingText: "",
              suggestions: [evt.suggestion, ...prev.suggestions].slice(0, 12),
            };
          }
          if (evt.type === "LIVE_RECONNECTING") {
            return {
              ...prev,
              degradedMessage: evt.message,
              stage: prev.stage === "live" ? "degraded" : prev.stage,
            };
          }
          if (evt.type === "LIVE_DEGRADED") {
            return { ...prev, degradedMessage: evt.message };
          }
          if (evt.type === "LIVE_ERROR") {
            return { ...prev, degradedMessage: evt.message, stage: "degraded" };
          }
          if (evt.type === "LIVE_FINALIZED") {
            return { ...prev, endedCleanly: evt.clean, stage: "ended" };
          }
          return prev;
        });
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  useEffect(() => {
    if (!snap || (snap.stage !== "live" && snap.stage !== "degraded") || snap.liveStatus === "paused") {
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [snap?.stage, snap?.liveStatus]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setStealthMasked((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const persistUi = useCallback(async (patch: Partial<WidgetUiState>) => {
    uiInitializedRef.current = true;
    uiSeqRef.current += 1;
    setUi((prev) => ({ ...prev, ...patch }));
    await sendBg({ type: "WIDGET_UPDATE_UI", patch }).catch(() => {});
  }, []);

  const startDrag = (e: React.PointerEvent, onClickOnly?: () => void) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement)?.closest("button, input, select, a")) return;
    e.preventDefault();
    const targetEl = e.currentTarget as HTMLElement | null;
    try {
      targetEl?.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable.
    }
    uiInitializedRef.current = true;
    uiSeqRef.current += 1;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: uiRef.current.x,
      originY: uiRef.current.y,
      lastX: uiRef.current.x,
      lastY: uiRef.current.y,
      moved: false,
    };

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        dragRef.current.moved = true;
      }
      const next = clampCoords(
        dragRef.current.originX + dx,
        dragRef.current.originY + dy,
        uiRef.current.expanded,
        uiRef.current.width,
        uiRef.current.height,
      );
      dragRef.current.lastX = next.x;
      dragRef.current.lastY = next.y;
      setUi((prev) => ({ ...prev, x: next.x, y: next.y }));
    };

    const onUp = () => {
      try {
        if (targetEl?.hasPointerCapture?.(e.pointerId)) {
          targetEl.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore release errors.
      }
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      const state = dragRef.current;
      dragRef.current = null;
      if (!state) return;
      if (state.moved) {
        void persistUi({ x: state.lastX, y: state.lastY });
      } else if (onClickOnly) {
        onClickOnly();
      }
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  };

  const startResize = (dir: "se" | "sw" | "e" | "w" | "s", e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const targetEl = e.currentTarget as HTMLElement | null;
    try {
      targetEl?.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable.
    }
    uiInitializedRef.current = true;
    uiSeqRef.current += 1;
    const size = clampSize(uiRef.current.width, uiRef.current.height);
    resizeRef.current = {
      dir,
      startX: e.clientX,
      startY: e.clientY,
      originX: uiRef.current.x,
      originY: uiRef.current.y,
      originW: size.width,
      originH: size.height,
      lastX: uiRef.current.x,
      lastW: size.width,
      lastH: size.height,
    };

    const onMove = (ev: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = ev.clientX - r.startX;
      const dy = ev.clientY - r.startY;
      let nextW = r.originW;
      let nextH = r.originH;
      let nextX = r.originX;

      if (r.dir === "se" || r.dir === "e") {
        const maxAllowedW = Math.min(680, window.innerWidth - r.originX - 8);
        nextW = Math.round(Math.min(Math.max(300, r.originW + dx), Math.max(300, maxAllowedW)));
      } else if (r.dir === "sw" || r.dir === "w") {
        const maxLeftShift = r.originX - 8;
        const proposedDelta = -dx;
        const clampedW = Math.min(
          Math.max(300, r.originW + proposedDelta),
          Math.min(680, r.originW + maxLeftShift),
        );
        nextW = Math.round(clampedW);
        nextX = Math.round(r.originX + (r.originW - nextW));
      }

      if (r.dir === "se" || r.dir === "sw" || r.dir === "s") {
        const maxAllowedH = Math.min(780, window.innerHeight - r.originY - 8);
        nextH = Math.round(Math.min(Math.max(260, r.originH + dy), Math.max(260, maxAllowedH)));
      }

      r.lastX = nextX;
      r.lastW = nextW;
      r.lastH = nextH;
      setUi((prev) => ({ ...prev, x: nextX, width: nextW, height: nextH }));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      const r = resizeRef.current;
      resizeRef.current = null;
      if (!r) return;
      void persistUi({ x: r.lastX, width: r.lastW, height: r.lastH });
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  };

  const applySizePreset = (targetW: number, targetH: number) => {
    const size = clampSize(targetW, targetH);
    const clamped = clampCoords(uiRef.current.x, uiRef.current.y, true, size.width, size.height);
    void persistUi({
      width: size.width,
      height: size.height,
      x: clamped.x,
      y: clamped.y,
    });
  };

  const handleExpand = () => {
    const size = clampSize(uiRef.current.width, uiRef.current.height);
    const clamped = clampCoords(uiRef.current.x, uiRef.current.y, true, size.width, size.height);
    void persistUi({
      expanded: true,
      x: clamped.x,
      y: clamped.y,
      width: size.width,
      height: size.height,
    });
    void hydrate(true);
  };

  const cleanupLocalDisplayCapture = useCallback(() => {
    const active = displayCaptureRef.current;
    if (!active) return;
    displayCaptureRef.current = null;
    try {
      active.cleanup();
    } catch {
      // Ignore audio teardown errors.
    }
    try {
      active.port.disconnect();
    } catch {
      // Ignore already disconnected port.
    }
    for (const track of active.stream.getTracks()) {
      track.onended = null;
      track.stop();
    }
    active.ctx.close().catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      cleanupLocalDisplayCapture();
    };
  }, [cleanupLocalDisplayCapture]);

  useEffect(() => {
    if (snap && snap.stage !== "live" && snap.stage !== "degraded") {
      cleanupLocalDisplayCapture();
    }
  }, [snap?.stage, cleanupLocalDisplayCapture]);

  const handleMinimize = () => {
    const clamped = clampCoords(uiRef.current.x, uiRef.current.y, false);
    void persistUi({ expanded: false, x: clamped.x, y: clamped.y });
  };

  const handleOpenWeb = async (path: string) => {
    const base = (snap?.webBaseUrl || "http://localhost:5173").replace(/\/+$/, "");
    await sendBg({ type: "OPEN_WEB_TAB", url: `${base}${path}` });
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await sendBg<{ ok?: boolean; error?: string; snapshot?: WidgetPublicSnapshot }>({
        type: "WIDGET_SIGN_IN",
        email,
        password,
      });
      if (!res.ok) throw new Error(res.error || "Sign in failed.");
      if (res.snapshot) setSnap(res.snapshot);
      setPassword("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  const handlePairCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await sendBg<{ ok?: boolean; error?: string; snapshot?: WidgetPublicSnapshot }>({
        type: "WIDGET_PAIR_CODE",
        token: pairingCode,
      });
      if (!res.ok) throw new Error(res.error || "Invalid pairing code.");
      if (res.snapshot) setSnap(res.snapshot);
      setPairingCode("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Invalid pairing code.");
    } finally {
      setBusy(false);
    }
  };

  const attachLocalDisplayAudioPort = async (stream: MediaStream) => {
    cleanupLocalDisplayCapture();
    const port = chrome.runtime.connect({ name: "vren-display-audio" });
    const ctx = new AudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    const sourceNode = ctx.createMediaStreamSource(stream);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;

    let teardown = () => {};
    let attachedWorklet = false;

    try {
      const chunkSamples = Math.max(1600, Math.round(ctx.sampleRate * 0.25));
      await ctx.audioWorklet.addModule(chrome.runtime.getURL("pcm-processor.js"));
      const worklet = new AudioWorkletNode(ctx, "vren-pcm-processor", {
        processorOptions: { chunkSamples },
      });
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const samples = event.data;
        if (!samples || samples.length === 0) return;
        const pcm = float32ToPcm16(samples, ctx.sampleRate);
        if (pcm.length === 0) return;
        try {
          port.postMessage({ source: "tab", payload: pcm16ToBase64(pcm) });
        } catch {
          // Ignore if port closed.
        }
      };
      sourceNode.connect(worklet);
      worklet.connect(silentGain);
      silentGain.connect(ctx.destination);
      teardown = () => {
        sourceNode.disconnect();
        worklet.disconnect();
        silentGain.disconnect();
      };
      attachedWorklet = true;
    } catch {
      // Fallback when host page CSP restricts AudioWorklet module URLs.
    }

    if (!attachedWorklet) {
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const pending: number[] = [];
      const targetChunk = Math.max(1600, Math.round(ctx.sampleRate * 0.25));
      processor.onaudioprocess = (ev) => {
        const channel = ev.inputBuffer.getChannelData(0);
        for (let i = 0; i < channel.length; i += 1) {
          pending.push(channel[i] ?? 0);
        }
        if (pending.length >= targetChunk) {
          const batch = new Float32Array(pending.splice(0, pending.length));
          const pcm = float32ToPcm16(batch, ctx.sampleRate);
          if (pcm.length > 0) {
            try {
              port.postMessage({ source: "tab", payload: pcm16ToBase64(pcm) });
            } catch {
              // Ignore if port closed.
            }
          }
        }
      };
      sourceNode.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(ctx.destination);
      teardown = () => {
        processor.onaudioprocess = null;
        sourceNode.disconnect();
        processor.disconnect();
        silentGain.disconnect();
      };
    }

    const [audioTrack] = stream.getAudioTracks();
    if (audioTrack) {
      audioTrack.onended = () => {
        cleanupLocalDisplayCapture();
        void sendBg({ type: "STOP_SESSION_CAPTURE", clean: true }).then(() => hydrate(false));
      };
    }

    displayCaptureRef.current = {
      stream,
      ctx,
      port,
      cleanup: teardown,
    };
  };

  const requestDisplayStream = async (preferTab: boolean): Promise<MediaStream> => {
    const baseConstraints: MediaStreamConstraints & { preferCurrentTab?: boolean } = {
      video: true,
      audio: true,
      ...(preferTab ? { preferCurrentTab: true } : {}),
    };
    const stream = await navigator.mediaDevices.getDisplayMedia(baseConstraints);
    if (stream.getAudioTracks().length === 0) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error(
        "No audio was shared. Click Start session again and make sure 'Also share audio' is checked.",
      );
    }
    for (const vt of stream.getVideoTracks()) {
      vt.enabled = false;
    }
    return stream;
  };

  const handleStartSession = async () => {
    if (!snap) return;
    setBusy(true);
    setErrorMsg(null);
    let acquiredStream: MediaStream | null = null;
    try {
      const selectedJob = snap.jobs.find((j) => j.id === snap.selection.jobId) ?? null;
      const wantsAudio = snap.selection.captureTab;
      const preferTab = snap.selection.captureTargetMode !== "desktop";
      let externalDisplayAudio = false;

      if (wantsAudio && (!preferTab || !snap.tabCaptureReady)) {
        acquiredStream = await requestDisplayStream(preferTab);
        externalDisplayAudio = true;
      }

      let res = await sendBg<{
        ok?: boolean;
        error?: string;
        sessionId?: string;
        needsDisplayPicker?: boolean;
      }>({
        type: "START_SESSION_CAPTURE",
        jobId: snap.selection.jobId,
        jobTitle: selectedJob?.title ?? "General Interview",
        company: selectedJob?.company ?? "",
        interviewType: snap.selection.interviewType,
        captureTab: wantsAudio,
        captureMic: snap.selection.captureMic && snap.micGranted,
        retainTranscript: snap.selection.retainTranscript,
        externalDisplayAudio,
      });

      if (!res.ok && res.needsDisplayPicker && wantsAudio && !acquiredStream) {
        acquiredStream = await requestDisplayStream(preferTab);
        res = await sendBg<{
          ok?: boolean;
          error?: string;
          sessionId?: string;
        }>({
          type: "START_SESSION_CAPTURE",
          jobId: snap.selection.jobId,
          jobTitle: selectedJob?.title ?? "General Interview",
          company: selectedJob?.company ?? "",
          interviewType: snap.selection.interviewType,
          captureTab: wantsAudio,
          captureMic: snap.selection.captureMic && snap.micGranted,
          retainTranscript: snap.selection.retainTranscript,
          externalDisplayAudio: true,
        });
      }

      if (!res.ok) throw new Error(res.error || "Could not start live capture.");

      if (acquiredStream) {
        await attachLocalDisplayAudioPort(acquiredStream);
        acquiredStream = null;
      }

      setElapsedSec(0);
      await hydrate(false);
    } catch (err) {
      if (acquiredStream) {
        for (const t of acquiredStream.getTracks()) t.stop();
      }
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setErrorMsg("Screen/tab audio share was cancelled. Click Start session to try again.");
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Failed to start capture.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePause = async () => {
    if (!snap) return;
    if (snap.liveStatus === "paused") {
      const res = await sendBg<{ ok?: boolean }>({ type: "RESUME_SESSION_CAPTURE" });
      if (res.ok) setSnap((p) => (p ? { ...p, liveStatus: "listening" } : p));
    } else {
      const res = await sendBg<{ ok?: boolean }>({ type: "PAUSE_SESSION_CAPTURE" });
      if (res.ok) setSnap((p) => (p ? { ...p, liveStatus: "paused" } : p));
    }
  };

  const handleStopSession = async (clean = true) => {
    cleanupLocalDisplayCapture();
    await sendBg({ type: "STOP_SESSION_CAPTURE", clean }).catch(() => {});
    await hydrate(false);
  };

  const handleQuickAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = quickQuestion.trim();
    if (!text) return;
    const res = await sendBg<{ ok?: boolean; error?: string }>({
      type: "SIMULATE_UTTERANCE",
      text,
      source: "tab",
    });
    if (res.ok) setQuickQuestion("");
    else if (res.error) setErrorMsg(res.error);
  };

  const isLive = snap?.stage === "live" || snap?.stage === "degraded";
  const latestSuggestion = useMemo(() => snap?.suggestions[0] ?? null, [snap?.suggestions]);
  const selectedJob = useMemo(
    () => (snap?.jobs.find((j) => j.id === snap.selection.jobId) ?? null),
    [snap?.jobs, snap?.selection.jobId],
  );
  const activeRoleLabel = selectedJob
    ? selectedJob.company
      ? `${selectedJob.title} (${selectedJob.company})`
      : selectedJob.title
    : "General interview";
  const cardSize = clampSize(ui.width, ui.height);
  const activePresetKey =
    SIZE_PRESETS.find((p) => Math.abs(p.width - cardSize.width) <= 8 && Math.abs(p.height - cardSize.height) <= 8)?.key ??
    null;

  if (ui.hidden) {
    return null;
  }

  return (
    <div className="vren-anchor" style={{ left: `${ui.x}px`, top: `${ui.y}px` }}>
      {!ui.expanded ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="Open Vren AI floating widget"
          title="Vren AI (drag to move, click to open)"
          className="vren-orb"
          onPointerDown={(e) => startDrag(e, handleExpand)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleExpand();
            }
          }}
        >
          <span>V</span>
          {isLive && (
            <span
              className="vren-orb-dot"
              style={{
                background: snap?.liveStatus === "paused" ? "#B86A3A" : "#22C55E",
              }}
            />
          )}
        </div>
      ) : (
        <section
          ref={cardRef}
          className="vren-card"
          aria-label="Vren AI floating assistant"
          style={{ width: `${cardSize.width}px`, height: `${cardSize.height}px` }}
        >
          <header className="vren-header" onPointerDown={(e) => startDrag(e)}>
            <div className="vren-brand">
              <span className="vren-logo">V</span>
              <span>Vren AI</span>
              {isLive && snap && (
                <span className="vren-status-pill">
                  <span
                    className="vren-live-dot"
                    style={{
                      background:
                        snap.liveStatus === "paused"
                          ? "#B86A3A"
                          : snap.stage === "degraded"
                            ? "#C2410C"
                            : "#15803D",
                    }}
                  />
                  <span>{formatDuration(elapsedSec)}</span>
                </span>
              )}
            </div>

            <div className="vren-h-actions">
              <div className="vren-size-pills" role="group" aria-label="Widget size presets">
                {SIZE_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    title={preset.label}
                    aria-label={preset.label}
                    className={`vren-size-btn ${activePresetKey === preset.key ? "active" : ""}`}
                    onClick={() => applySizePreset(preset.width, preset.height)}
                  >
                    {preset.key}
                  </button>
                ))}
              </div>
              {isLive && (
                <button
                  type="button"
                  className="vren-btn-danger"
                  onClick={() => void handleStopSession(true)}
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                className="vren-icon-btn"
                title="Minimize back to floating draggable icon"
                onClick={handleMinimize}
                aria-label="Minimize floating widget"
              >
                _
              </button>
            </div>
          </header>

          {snap && snap.authenticated && snap.stage !== "welcome" && (
            <div className="vren-context-bar" aria-label="Active interview grounding context">
              <div className="vren-context-summary">
                <span className="vren-context-role" title={activeRoleLabel}>
                  {activeRoleLabel}
                </span>
                <span className="vren-chip">{snap.selection.interviewType}</span>
                <span className="vren-chip vren-chip-neutral">
                  {snap.profileExperienceCount} CV
                </span>
              </div>
              <span
                className="vren-chip vren-chip-neutral"
                style={{
                  color: snap.apiHealthy ? "#0F5E54" : "#9F2D2D",
                  background: snap.apiHealthy ? "#E3EEE9" : "#FDECEC",
                }}
              >
                {snap.apiHealthy ? "API Online" : "API Offline"}
              </span>
            </div>
          )}

          <div className="vren-body">
            {!snap || !snap.authenticated || snap.stage === "welcome" ? (
              <>
                <div className="vren-panel">
                  <strong style={{ fontSize: 14 }}>Connect Vren AI</strong>
                  <p className="vren-muted" style={{ margin: "4px 0 12px" }}>
                    Drag anywhere on the header, resize from the corners or edges, or press Minimize (_) to dock as a floating icon.
                  </p>
                  <button
                    type="button"
                    className="vren-btn-primary"
                    onClick={() => void handleOpenWeb("/app/settings")}
                  >
                    Connect in one click via Dashboard
                  </button>
                </div>

                <div className="vren-panel">
                  <div className="vren-tabs" style={{ marginBottom: 10 }}>
                    <button
                      type="button"
                      className={`vren-tab ${authTab === "signin" ? "active" : ""}`}
                      onClick={() => {
                        setAuthTab("signin");
                        setErrorMsg(null);
                      }}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      className={`vren-tab ${authTab === "code" ? "active" : ""}`}
                      onClick={() => {
                        setAuthTab("code");
                        setErrorMsg(null);
                      }}
                    >
                      Pairing code
                    </button>
                  </div>

                  {authTab === "signin" ? (
                    <form onSubmit={handleSignIn} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      <input
                        className="vren-input"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email address"
                      />
                      <input
                        className="vren-input"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                      />
                      {errorMsg && <p className="vren-err">{errorMsg}</p>}
                      <button type="submit" disabled={busy} className="vren-btn-outline">
                        {busy ? "Connecting..." : "Sign in and connect"}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handlePairCode} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      <input
                        className="vren-input"
                        type="text"
                        required
                        value={pairingCode}
                        onChange={(e) => setPairingCode(e.target.value)}
                        placeholder="vren_ext_..."
                      />
                      {errorMsg && <p className="vren-err">{errorMsg}</p>}
                      <button type="submit" disabled={busy} className="vren-btn-outline">
                        {busy ? "Verifying..." : "Connect with pairing code"}
                      </button>
                    </form>
                  )}
                </div>
              </>
            ) : isLive ? (
              <>
                <div className="vren-row">
                  <div className="vren-tabs" style={{ flex: 1 }}>
                    <button
                      type="button"
                      className={`vren-tab ${liveTab === "answer" ? "active" : ""}`}
                      onClick={() => setLiveTab("answer")}
                    >
                      Answer
                    </button>
                    <button
                      type="button"
                      className={`vren-tab ${liveTab === "transcript" ? "active" : ""}`}
                      onClick={() => setLiveTab("transcript")}
                    >
                      Transcript ({snap.transcript.length})
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="vren-icon-btn"
                      onClick={() => setStealthMasked((p) => !p)}
                    >
                      {stealthMasked ? "Show" : "Hide"}
                    </button>
                    <button
                      type="button"
                      className="vren-icon-btn"
                      onClick={() => setCompactMode((p) => !p)}
                    >
                      {compactMode ? "Full" : "Focus"}
                    </button>
                    <button
                      type="button"
                      className="vren-icon-btn"
                      onClick={() => void handleTogglePause()}
                    >
                      {snap.liveStatus === "paused" ? "Resume" : "Pause"}
                    </button>
                  </div>
                </div>

                {stealthMasked ? (
                  <div className="vren-panel" style={{ textAlign: "center", padding: "22px 16px" }}>
                    <strong style={{ fontSize: 13.5 }}>Notes hidden (Alt+H)</strong>
                    <p className="vren-muted" style={{ margin: "6px 0 0" }}>
                      Press Alt+H or click Show whenever you need your talking points back.
                    </p>
                  </div>
                ) : liveTab === "transcript" ? (
                  <div className="vren-panel" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                    <div className="vren-transcript">
                      {snap.transcript.length === 0 ? (
                        <p className="vren-muted" style={{ margin: 0 }}>
                          No transcript turns yet. Questions and your responses appear here automatically.
                        </p>
                      ) : (
                        snap.transcript.map((item) => (
                          <div
                            key={item.id}
                            className={`vren-turn ${item.source === "microphone" ? "is-user" : ""}`}
                          >
                            <div className="vren-row" style={{ marginBottom: 3 }}>
                              <strong style={{ color: "#0F5E54", fontSize: 12 }}>
                                {item.speaker}
                              </strong>
                              <span className="vren-muted" style={{ fontSize: 11 }}>
                                {item.timestamp}
                              </span>
                            </div>
                            <div style={{ color: "#121A18" }}>{item.text}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="vren-answer-card">
                    {(snap.detectedQuestion || snap.streamingText) ? (
                      <div>
                        <div className="vren-row">
                          <span className="vren-chip">Answering live</span>
                          <span className="vren-muted">Streaming</span>
                        </div>
                        {snap.detectedQuestion && (
                          <strong className="vren-question-title">{snap.detectedQuestion}</strong>
                        )}
                        <p className="vren-stream-text">
                          {snap.streamingText || "Drafting your spoken answer..."}
                        </p>
                      </div>
                    ) : latestSuggestion ? (
                      <div>
                        <div className="vren-row">
                          <span className="vren-chip">
                            {latestSuggestion.questionType} · {latestSuggestion.framework}
                          </span>
                          <span className="vren-muted">{latestSuggestion.askedAt}</span>
                        </div>
                        <strong className="vren-question-title">
                          {latestSuggestion.questionText}
                        </strong>
                        <ul className="vren-bullets">
                          {latestSuggestion.outline.map((point, idx) => (
                            <li key={idx}>
                              <span className="vren-bullet-dot" />
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                        {latestSuggestion.evidenceRef && (
                          <div className="vren-evidence">
                            Grounded in: {latestSuggestion.evidenceRef}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <strong style={{ fontSize: 14 }}>Listening on this interview</strong>
                        <p className="vren-muted" style={{ margin: "6px 0 0", lineHeight: 1.5 }}>
                          Ready for the next interviewer question. Resize any corner or edge to match your screen layout, or minimize (_) back to the draggable icon.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : snap.stage === "ended" ? (
              <div className="vren-panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <strong style={{ fontSize: 14 }}>
                  {snap.endedCleanly ? "Session ended" : "Session interrupted"}
                </strong>
                <span className="vren-muted">Duration: {formatDuration(elapsedSec)}</span>
                {snap.sessionId && (
                  <button
                    type="button"
                    className="vren-btn-primary"
                    onClick={() => void handleOpenWeb(`/app/sessions/${snap.sessionId}`)}
                  >
                    Review session on dashboard
                  </button>
                )}
                <button
                  type="button"
                  className="vren-btn-outline"
                  onClick={() => void sendBg({ type: "WIDGET_RESET_ENDED" }).then(() => hydrate(false))}
                >
                  Prepare another session
                </button>
              </div>
            ) : (
              <>
                <div className="vren-panel">
                  <div className="vren-row" style={{ marginBottom: 10 }}>
                    <div>
                      <strong style={{ fontSize: 13.5 }}>
                        {snap.profileName || snap.userEmail}
                      </strong>
                      <div className="vren-muted">Grounded context & role setup</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="vren-icon-btn"
                        onClick={() => void handleOpenWeb("/app/prepare")}
                      >
                        Prepare
                      </button>
                      <button
                        type="button"
                        className="vren-icon-btn"
                        onClick={() => void sendBg({ type: "WIDGET_REFRESH_WORKSPACE" }).then(() => hydrate(true))}
                      >
                        Sync
                      </button>
                      <button
                        type="button"
                        className="vren-icon-btn"
                        onClick={() => void sendBg({ type: "WIDGET_SIGN_OUT" }).then(() => hydrate(false))}
                      >
                        Sign out
                      </button>
                    </div>
                  </div>

                  <div className="vren-grid-2">
                    <div>
                      <label className="vren-section-label">Target role</label>
                      <select
                        className="vren-select"
                        value={snap.selection.jobId ?? ""}
                        onChange={(e) =>
                          void sendBg({
                            type: "WIDGET_UPDATE_SELECTION",
                            patch: { jobId: e.target.value || null },
                          }).then(() => hydrate(false))
                        }
                      >
                        <option value="">General interview</option>
                        {snap.jobs.map((job) => (
                          <option key={job.id} value={job.id}>
                            {job.title}
                            {job.company ? ` - ${job.company}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="vren-section-label">Interview type</label>
                      <select
                        className="vren-select"
                        value={snap.selection.interviewType}
                        onChange={(e) =>
                          void sendBg({
                            type: "WIDGET_UPDATE_SELECTION",
                            patch: { interviewType: e.target.value as InterviewType },
                          }).then(() => hydrate(false))
                        }
                      >
                        {INTERVIEW_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="vren-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <span className="vren-section-label">Interview location</span>
                    <div className="vren-tabs">
                      <button
                        type="button"
                        className={`vren-tab ${snap.selection.captureTargetMode !== "desktop" ? "active" : ""}`}
                        onClick={() =>
                          void sendBg({
                            type: "WIDGET_UPDATE_SELECTION",
                            patch: { captureTargetMode: "tab" },
                          }).then(() => hydrate(false))
                        }
                      >
                        Current Chrome tab
                      </button>
                      <button
                        type="button"
                        className={`vren-tab ${snap.selection.captureTargetMode === "desktop" ? "active" : ""}`}
                        onClick={() =>
                          void sendBg({
                            type: "WIDGET_UPDATE_SELECTION",
                            patch: { captureTargetMode: "desktop" },
                          }).then(() => hydrate(false))
                        }
                      >
                        Window / screen
                      </button>
                    </div>
                  </div>

                  <label className="vren-switch-row">
                    <span>Capture interviewer audio</span>
                    <input
                      type="checkbox"
                      className="vren-switch-input"
                      checked={snap.selection.captureTab}
                      onChange={(e) =>
                        void sendBg({
                          type: "WIDGET_UPDATE_SELECTION",
                          patch: { captureTab: e.target.checked },
                        }).then(() => hydrate(false))
                      }
                    />
                  </label>

                  <label className="vren-switch-row">
                    <span>Capture microphone</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {snap.selection.captureMic && !snap.micGranted && (
                        <button
                          type="button"
                          className="vren-icon-btn"
                          onClick={(e) => {
                            e.preventDefault();
                            void sendBg({ type: "OPEN_PERMISSIONS_TAB" });
                          }}
                        >
                          Allow mic
                        </button>
                      )}
                      <input
                        type="checkbox"
                        className="vren-switch-input"
                        checked={snap.selection.captureMic}
                        onChange={(e) =>
                          void sendBg({
                            type: "WIDGET_UPDATE_SELECTION",
                            patch: { captureMic: e.target.checked },
                          }).then(() => hydrate(false))
                        }
                      />
                    </div>
                  </label>

                  <label className="vren-switch-row">
                    <span>Save transcript after session</span>
                    <input
                      type="checkbox"
                      className="vren-switch-input"
                      checked={snap.selection.retainTranscript}
                      onChange={(e) =>
                        void sendBg({
                          type: "WIDGET_UPDATE_SELECTION",
                          patch: { retainTranscript: e.target.checked },
                        }).then(() => hydrate(false))
                      }
                    />
                  </label>
                </div>

                {errorMsg && <p className="vren-err">{errorMsg}</p>}

                <button
                  type="button"
                  disabled={busy || (!snap.selection.captureTab && !snap.selection.captureMic)}
                  onClick={() => void handleStartSession()}
                  className="vren-btn-primary"
                >
                  {busy ? "Starting..." : "Start session"}
                </button>
              </>
            )}
          </div>

          {isLive && !stealthMasked && !compactMode && snap?.sttMode === "offline" && (
            <form onSubmit={handleQuickAsk} className="vren-footer-ask">
              <input
                className="vren-input"
                value={quickQuestion}
                onChange={(e) => setQuickQuestion(e.target.value)}
                placeholder="Ask or paste interviewer question..."
              />
              <button type="submit" className="vren-btn-outline">
                Ask
              </button>
            </form>
          )}

          <div
            className="vren-resize-w"
            onPointerDown={(e) => startResize("w", e)}
            title="Drag to resize width"
          />
          <div
            className="vren-resize-e"
            onPointerDown={(e) => startResize("e", e)}
            title="Drag to resize width"
          />
          <div
            className="vren-resize-s"
            onPointerDown={(e) => startResize("s", e)}
            title="Drag to resize height"
          />
          <div
            className="vren-resize-sw"
            onPointerDown={(e) => startResize("sw", e)}
            title="Drag corner to resize"
          />
          <div
            className="vren-resize-se"
            role="presentation"
            aria-label="Drag corner to resize widget"
            title="Drag corner to resize"
            onPointerDown={(e) => startResize("se", e)}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <path d="M9.5 1.5L1.5 9.5M9.5 5.5L5.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </div>
        </section>
      )}
    </div>
  );
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  main() {
    if (document.getElementById("vren-ai-floating-host")) return;
    const host = document.createElement("div");
    host.id = "vren-ai-floating-host";
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = WIDGET_CSS;
    shadow.appendChild(style);

    const mount = document.createElement("div");
    shadow.appendChild(mount);
    createRoot(mount).render(<FloatingWidgetApp />);
  },
});

