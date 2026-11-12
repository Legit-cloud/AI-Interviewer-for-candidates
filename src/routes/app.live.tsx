import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageTransition } from "@/components/motion";
import { apiFetch } from "@/lib/api";
import { PageHeader, Status } from "@/components/vren";
import {
  ANSWER_LENGTHS,
  endSessionById,
  FRAMEWORKS,
  hydrateFromBackend,
  INTERVIEW_TYPES,
  matchJob,
  RESPONSE_STYLES,
  startLiveSession,
  updatePreferences,
  useAppState,
  type LiveAnswer,
  type LiveConnection,
  type LiveServerEvent,
  type LiveSessionHandle,
} from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/live")({
  validateSearch: (s: Record<string, unknown>): { job?: string | undefined } => ({
    job: typeof s["job"] === "string" ? (s["job"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Live session | Vren AI" },
      {
        name: "description",
        content: "Start a live session, pair the extension and follow answers.",
      },
    ],
  }),
  component: LiveSessionPage,
});

type Phase = "setup" | "live" | "ended";

interface Pending {
  questionId: string;
  question: string;
  text: string;
}

interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  at: string;
}

function useCountdown(expiresAt: string | undefined): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () =>
      setLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              value === o
                ? "border-primary bg-primary-soft/80 font-medium text-primary"
                : "bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function LiveSessionPage() {
  const { jobs, preferences, sessions, profile } = useAppState();
  const { job: jobParam } = Route.useSearch();
  const activeJobs = jobs.filter((j) => !j.archived);

  const [phase, setPhase] = useState<Phase>("setup");
  const [jobId, setJobId] = useState<string>(jobParam ?? "");
  const [interviewType, setInterviewType] = useState<string>(INTERVIEW_TYPES[0]);
  const [retain, setRetain] = useState(preferences.retainTranscriptDefault);
  const [ackRules, setAckRules] = useState(false);
  const [starting, setStarting] = useState(false);

  const handle = useRef<LiveSessionHandle | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [connection, setConnection] = useState<LiveConnection>("connecting");
  const [capture, setCapture] = useState<"idle" | "listening" | "paused">("idle");
  const [paired, setPaired] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [answers, setAnswers] = useState<LiveAnswer[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [notice, setNotice] = useState("");
  const [ai, setAi] = useState<{ answers: boolean; transcription: string } | null>(null);
  const [testText, setTestText] = useState("");
  const countdown = useCountdown(pairing?.expiresAt);

  useEffect(() => () => handle.current?.close(), []);

  // Pasting an image while a session is live sends it as a question.
  useEffect(() => {
    if (phase !== "live") return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void handle.current?.askImage(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [phase]);

  // Pre-flight: tell the user up front if the server has no AI or speech-to-text keys.
  useEffect(() => {
    apiFetch<{ ai?: { answers: boolean; transcription: string } }>(
      "/v1/health",
      {},
      { auth: false },
    )
      .then((h) => setAi(h.ai ?? null))
      .catch(() => setAi(null));
  }, []);

  // Warn before closing the tab while a live session is running.
  useEffect(() => {
    if (phase !== "live") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  // A session left running (for example after closing this page) can be picked up again.
  const resumable = useMemo(
    () =>
      sessions.find(
        (s) =>
          (s.state === "live" || s.state === "interrupted") &&
          Date.now() - new Date(s.date).getTime() < 2 * 60 * 60 * 1000,
      ),
    [sessions],
  );

  const onEvent = useCallback((evt: LiveServerEvent) => {
    switch (evt.type) {
      case "session.ready": {
        const notes: string[] = [];
        if (evt["stt_mode"] === "offline")
          notes.push("Speech-to-text is not set up on the server, so audio cannot be transcribed.");
        if (evt["answers_ready"] === false)
          notes.push("The AI provider is not set up on the server, so no answers can be written.");
        if (notes.length) setNotice(notes.join(" "));
        break;
      }
      case "capture.state": {
        setPaired(true);
        setCapture(evt["state"] === "paused" ? "paused" : "listening");
        break;
      }
      case "transcript.completed": {
        setTranscript((t) => [
          ...t.slice(-39),
          {
            id: String(evt["item_id"] ?? evt.event_id),
            speaker: String(evt["speaker"] ?? ""),
            text: String(evt["text"] ?? ""),
            at: String(evt["timestamp"] ?? ""),
          },
        ]);
        break;
      }
      case "answer.started": {
        setNotice("");
        setPending({
          questionId: String(evt["question_id"]),
          question: String(evt["question_text"] ?? ""),
          text: "",
        });
        break;
      }
      case "answer.delta": {
        setPending((p) =>
          p && p.questionId === evt["question_id"]
            ? { ...p, text: p.text + String(evt["delta"] ?? "") }
            : p,
        );
        break;
      }
      case "answer.ready": {
        // The final answer has passed the claim check, so it replaces whatever streamed in.
        const ready = evt["answer"] as LiveAnswer;
        setAnswers((a) => (a.some((x) => x.id === ready.id) ? a : [ready, ...a]));
        setPending(null);
        break;
      }
      case "answer.unavailable": {
        setPending(null);
        setNotice(String(evt["message"] ?? "Answer unavailable for this question."));
        break;
      }
      case "session.degraded": {
        setNotice(String(evt["message"] ?? "The session is degraded."));
        break;
      }
      case "session.expired":
      case "session.finalized": {
        setPhase("ended");
        void hydrateFromBackend(); // so the review page has the finished session
        break;
      }
      default:
        break;
    }
  }, []);

  const start = async (resumeSessionId?: string) => {
    setStarting(true);
    try {
      const h = await startLiveSession(
        {
          jobId: jobId || null,
          retainTranscript: retain,
          interviewType,
          ...(resumeSessionId ? { resumeSessionId } : {}),
        },
        onEvent,
        setConnection,
      );
      handle.current = h;
      setSessionId(h.sessionId);
      setPairing(h.pairing);
      setAnswers(h.history);
      setPhase("live");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the live session.");
    } finally {
      setStarting(false);
    }
  };

  const endOld = async (id: string) => {
    try {
      await endSessionById(id);
      toast.success("Session ended.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not end that session.");
    }
  };

  const newCode = async () => {
    try {
      setPairing(await handle.current!.refreshPairingCode());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create a new code.");
    }
  };

  const revoke = async () => {
    try {
      await handle.current!.revokePairing();
      setPaired(false);
      setPairing(null);
      toast.success("Pairing revoked. The extension has been disconnected.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke pairing.");
    }
  };

  const latest = answers[0];
  const earlier = useMemo(() => answers.slice(1), [answers]);

  if (phase === "setup") {
    return (
      <PageTransition className="space-y-8">
        <PageHeader
          eyebrow="Live"
          title="Start a live session"
          description="You set everything up here. The extension only relays tab audio when you press Start capture, and shows the answers."
        />
        {ai && (!ai.answers || ai.transcription === "offline") && (
          <section
            role="status"
            aria-label="Server setup"
            className="rounded-xl border border-copper/30 bg-copper-soft/40 p-5 text-sm"
          >
            <p className="font-medium">The server is not fully set up for live answers</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {!ai.answers && <li>No AI provider key. Add LLM_API_KEY to backend/.env.</li>}
              {ai.transcription === "offline" && (
                <li>
                  No speech-to-text. Set STT_PROVIDER=deepgram and DEEPGRAM_API_KEY in backend/.env.
                </li>
              )}
            </ul>
            <p className="mt-2 text-muted-foreground">
              You can still start a session and type test questions, but nothing is transcribed or
              answered until this is set up.
            </p>
          </section>
        )}
        {resumable && (
          <section
            aria-label="Session in progress"
            className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary-soft/40 p-5 md:flex-row md:items-center md:justify-between"
          >
            <div>
              <p className="font-medium">You have a session in progress</p>
              <p className="text-sm text-muted-foreground">
                Started{" "}
                {new Date(resumable.date).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                . Pick it up again, or end it before starting a new one.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void start(resumable.id)} disabled={starting}>
                Resume
              </Button>
              <Button variant="outline" onClick={() => void endOld(resumable.id)}>
                End it
              </Button>
            </div>
          </section>
        )}
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-5 rounded-xl border bg-card p-5">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Target job</span>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-base md:h-9 md:text-sm"
              >
                <option value="">General interview</option>
                {activeJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                    {j.company ? ` · ${j.company}` : ""}
                  </option>
                ))}
              </select>
            </label>

            {(() => {
              const job = jobs.find((j) => j.id === jobId);
              const gaps = job ? matchJob(job, profile).filter((m) => m.state === "gap").length : 0;
              const checks = [
                {
                  ok: (profile?.experience.length ?? 0) > 0,
                  text: "Your CV is added",
                  fix: "Add your experience so answers use your real background.",
                },
                {
                  ok: !!job && job.required.length > 0,
                  text: "A job is chosen",
                  fix: "Pick a job so answers fit the role.",
                },
              ];
              return (
                <ul className="space-y-1 text-sm" aria-label="Before you start">
                  {checks.map((c) => (
                    <li key={c.text} className={c.ok ? "text-muted-foreground" : "text-copper"}>
                      {c.ok ? "✓ " : "• "}
                      {c.ok ? c.text : c.fix}
                    </li>
                  ))}
                  {gaps > 0 && job && (
                    <li className="text-muted-foreground">
                      {gaps} job {gaps === 1 ? "requirement is" : "requirements are"} not in your
                      CV.{" "}
                      <Link
                        to="/app/jobs/$jobId"
                        params={{ jobId: job.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        See which
                      </Link>
                    </li>
                  )}
                </ul>
              );
            })()}

            <div className="space-y-4">
              <Segmented
                label="Interview type"
                value={interviewType}
                options={INTERVIEW_TYPES}
                onChange={setInterviewType}
              />
              <Segmented
                label="Answer length"
                value={preferences.length}
                options={ANSWER_LENGTHS}
                onChange={(v) => updatePreferences({ length: v })}
              />
              <Segmented
                label="Answer style"
                value={preferences.style}
                options={RESPONSE_STYLES}
                onChange={(v) => updatePreferences({ style: v })}
              />
              <Segmented
                label="Story format"
                value={preferences.framework}
                options={FRAMEWORKS}
                onChange={(v) => updatePreferences({ framework: v })}
              />
            </div>

            <div className="space-y-3 rounded-lg border bg-background p-4 text-sm">
              <p className="font-medium">What gets captured</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  Audio from the browser tab you choose, sent for live transcription while the
                  session runs.
                </li>
                <li>
                  Raw audio is not kept. Chrome shows its own recording indicator on the captured
                  tab.
                </li>
                <li>You can stop at any time from this page or from the extension.</li>
              </ul>
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={retain}
                  onChange={(e) => setRetain(e.target.checked)}
                  className="mt-0.5 size-4"
                />
                <span>Keep the transcript after the session so I can review it.</span>
              </label>
            </div>

            <div className="space-y-3 rounded-lg border border-copper/30 bg-copper-soft/40 p-4 text-sm">
              <p className="font-medium">Before you share your screen</p>
              <p className="text-muted-foreground">
                Answers appear in the extension&apos;s Side Panel, not in the meeting page. The
                panel is part of your browser window: sharing a single tab does not include it, but
                sharing your whole screen or browser window may show it. Check what you are sharing.
              </p>
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={ackRules}
                  onChange={(e) => setAckRules(e.target.checked)}
                  className="mt-0.5 size-4"
                />
                <span>
                  I confirm that using an assistive tool is allowed in this interview, or I accept
                  responsibility for using it. Vren AI cannot check the interviewer&apos;s rules.
                </span>
              </label>
            </div>

            <Button
              onClick={() => void start()}
              disabled={!ackRules || starting}
              className="w-full md:w-auto"
            >
              {starting ? "Starting…" : "Start live session"}
            </Button>
          </div>

          <aside className="space-y-3 rounded-xl border bg-card p-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">How it works</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Start the session. You get a 6-digit pairing code.</li>
              <li>
                Open your interview tab, then open the Vren extension panel and enter the code.
              </li>
              <li>Press Start capture in the panel.</li>
              <li>Each question the interviewer asks gets a ready-to-say answer.</li>
            </ol>
            <p>
              No extension yet? You can still try the flow here by typing a question into the test
              box once the session starts.
            </p>
          </aside>
        </div>
      </PageTransition>
    );
  }

  const connectionTone =
    connection === "connected" ? "success" : connection === "closed" ? "error" : "warning";

  return (
    <PageTransition className="space-y-6">
      <PageHeader
        eyebrow="Live"
        title={phase === "ended" ? "Session ended" : "Live session"}
        description={
          phase === "ended"
            ? "The session has been finalised. Your review is ready."
            : "Keep this page open, or hide it. The session continues without it."
        }
        actions={
          phase === "ended" ? (
            <Button asChild>
              <Link to="/app/sessions/$sessionId" params={{ sessionId }}>
                Review session
              </Link>
            </Button>
          ) : (
            <>
              <Status tone={connectionTone} pulse={connection === "reconnecting"}>
                {connection === "connected"
                  ? "Connected"
                  : connection === "closed"
                    ? "Disconnected"
                    : "Reconnecting"}
              </Status>
              <Status
                tone={capture === "listening" ? "success" : "neutral"}
                pulse={capture === "listening"}
              >
                {capture === "idle"
                  ? "Waiting for extension"
                  : capture === "listening"
                    ? "Listening"
                    : "Paused"}
              </Status>
            </>
          )
        }
      />

      {phase === "live" && (
        <div className="flex flex-wrap items-center gap-2.5">
          {capture === "paused" ? (
            <Button variant="outline" onClick={() => handle.current?.resume()}>
              Resume
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => handle.current?.pause()}
              disabled={capture === "idle"}
            >
              Pause
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={() => {
              if (window.confirm("End this session? Capture stops and the session is finalised.")) {
                handle.current?.stop();
              }
            }}
          >
            Stop session
          </Button>
        </div>
      )}

      {phase === "live" && !paired && (
        <section className="rounded-xl border bg-card p-5" aria-label="Pairing code">
          {pairing && countdown > 0 ? (
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="eyebrow mb-1">Pairing code</p>
                <p
                  className="font-mono text-4xl tracking-[0.3em] text-foreground"
                  aria-live="polite"
                >
                  {pairing.code}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Enter it in the Vren extension panel. Expires in {Math.floor(countdown / 60)}:
                  {String(countdown % 60).padStart(2, "0")}. It works once.
                </p>
              </div>
              <Button variant="outline" onClick={newCode}>
                New code
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                The pairing code has expired or been used.
              </p>
              <Button variant="outline" onClick={newCode}>
                Get a new code
              </Button>
            </div>
          )}
        </section>
      )}

      {phase === "live" && paired && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-5 py-3 text-sm">
          <span className="text-muted-foreground">Extension paired.</span>
          <Button variant="ghost" size="sm" onClick={revoke}>
            Revoke pairing
          </Button>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-xl border border-copper/30 bg-copper-soft/40 px-5 py-3 text-sm"
        >
          {notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="space-y-4" aria-label="Answers">
          {pending && (
            <article className="rounded-xl border border-primary/30 bg-primary-soft/40 p-5">
              <p className="eyebrow mb-1">Answering</p>
              <p className="text-sm text-muted-foreground">{pending.question}</p>
              <p className="mt-3 whitespace-pre-wrap text-lg leading-relaxed">
                {pending.text || "…"}
              </p>
            </article>
          )}
          {latest ? (
            <AnswerCard answer={latest} featured />
          ) : (
            !pending && (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                {phase === "ended"
                  ? "No answers were generated in this session."
                  : "Listening for questions. Answers will appear here."}
              </div>
            )
          )}
          {earlier.map((a) => (
            <AnswerCard key={a.id} answer={a} />
          ))}
        </section>

        <aside className="space-y-4">
          {phase === "live" && (
            <div className="space-y-2 rounded-xl border bg-card p-4">
              <p className="text-sm font-medium">Question on screen?</p>
              <p className="text-sm text-muted-foreground">
                Paste a screenshot (Ctrl or Cmd + V) or choose a file. Vren reads it and answers.
              </p>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Choose a screenshot"
                className="text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handle.current?.askImage(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}
          {phase === "live" && (
            <form
              className="space-y-2 rounded-xl border bg-card p-4"
              onSubmit={(e) => {
                e.preventDefault();
                const text = testText.trim();
                if (!text) return;
                handle.current?.simulate(text);
                setTestText("");
              }}
            >
              <label htmlFor="test-question" className="text-sm font-medium">
                Test without audio
              </label>
              <Input
                id="test-question"
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder="Type a question the interviewer might ask"
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={connection !== "connected"}
              >
                Ask
              </Button>
            </form>
          )}
          <div className="rounded-xl border bg-card p-4">
            <p className="mb-2 text-sm font-medium">Transcript</p>
            {transcript.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-auto text-sm">
                {transcript.map((t) => (
                  <li key={t.id}>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {t.at} {t.speaker}
                    </span>
                    <p>{t.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </PageTransition>
  );
}

function AnswerCard({ answer, featured = false }: { answer: LiveAnswer; featured?: boolean }) {
  return (
    <article className={cn("rounded-xl border bg-card p-5", featured && "border-ink/20 shadow-xs")}>
      <p className="text-sm text-muted-foreground">{answer.question_text}</p>
      <p className={cn("mt-3 leading-relaxed", featured ? "text-xl" : "text-base")}>
        {answer.answer}
      </p>
      {answer.key_points.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {answer.key_points.map((k) => (
            <li
              key={k}
              className="rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground"
            >
              {k}
            </li>
          ))}
        </ul>
      )}
      {answer.code && (
        <pre className="mt-3 overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed">
          {answer.code}
        </pre>
      )}
      <p className="mt-3 font-mono text-[11px] text-muted-foreground">
        {answer.source_label}
        {answer.caveat ? ` · ${answer.caveat}` : ""}
      </p>
    </article>
  );
}
