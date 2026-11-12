import { createFileRoute } from "@tanstack/react-router";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageTransition } from "@/components/motion";
import { EmptyState, PageHeader, Status } from "@/components/vren";
import {
  INTERVIEW_TYPES,
  mockApi,
  useAppState,
  type MockInterview,
  type MockTurn,
} from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/mock")({
  head: () => ({
    meta: [
      { title: "Practice | Vren AI" },
      { name: "description", content: "Practise an interview and get coaching on each answer." },
    ],
  }),
  component: MockPage,
});

const SPEECH_LANG: Record<string, string> = {
  English: "en-US",
  French: "fr-FR",
  Spanish: "es-ES",
  German: "de-DE",
  Portuguese: "pt-PT",
  Italian: "it-IT",
  Dutch: "nl-NL",
  Polish: "pl-PL",
  Russian: "ru-RU",
  Turkish: "tr-TR",
  Japanese: "ja-JP",
  Korean: "ko-KR",
  Chinese: "zh-CN",
  Hindi: "hi-IN",
  Arabic: "ar-SA",
};

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

/** Lets the user speak the answer. Uses the browser's own speech recognition when it has one. */
function useDictation(language: string, onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const Ctor = (
    typeof window !== "undefined"
      ? ((window as unknown as Record<string, unknown>)["SpeechRecognition"] ??
        (window as unknown as Record<string, unknown>)["webkitSpeechRecognition"])
      : undefined
  ) as (new () => SpeechRecognitionLike) | undefined;

  const stop = useCallback(() => {
    rec.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = SPEECH_LANG[language] ?? "en-US";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let said = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const result = e.results[i];
        if (result?.isFinal && result[0]) said += result[0].transcript;
      }
      if (said) onText(said.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }, [Ctor, language, onText]);

  useEffect(() => () => rec.current?.stop(), []);
  return { supported: Boolean(Ctor), listening, start, stop };
}

function scoreTone(score: number) {
  return score >= 4 ? "success" : score >= 3 ? "warning" : "error";
}

function MockPage() {
  const { jobs, preferences } = useAppState();
  const activeJobs = jobs.filter((j) => !j.archived);
  const [past, setPast] = useState<MockInterview[]>([]);
  const [mock, setMock] = useState<MockInterview | null>(null);
  const [jobId, setJobId] = useState("");
  const [type, setType] = useState<string>(INTERVIEW_TYPES[0]);
  const [count, setCount] = useState(5);
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "making" | "checking" | "finishing">("");

  const refresh = useCallback(
    () =>
      mockApi
        .list()
        .then(setPast)
        .catch(() => setPast([])),
    [],
  );
  useEffect(() => void refresh(), [refresh]);

  const dictation = useDictation(preferences.language, (said) =>
    setText((t) => (t ? `${t} ${said}` : said)),
  );

  const fail = (err: unknown, fallback: string) =>
    toast.error(err instanceof Error ? err.message : fallback);

  const begin = async () => {
    setBusy("making");
    try {
      const created = await mockApi.create(jobId || null, type, count);
      setMock(created);
      setIndex(0);
      setText("");
      void refresh();
    } catch (err) {
      fail(err, "Could not start the practice interview.");
    } finally {
      setBusy("");
    }
  };

  const resume = (m: MockInterview) => {
    setMock(m);
    const next = m.turns.findIndex((t) => !t.answer);
    setIndex(next === -1 ? m.turns.length - 1 : next);
    setText("");
  };

  const submit = async () => {
    if (!mock || text.trim().length < 3) return;
    dictation.stop();
    setBusy("checking");
    try {
      setMock(await mockApi.answer(mock.id, index, text.trim()));
    } catch (err) {
      fail(err, "Could not check that answer.");
    } finally {
      setBusy("");
    }
  };

  const finish = async () => {
    if (!mock) return;
    setBusy("finishing");
    try {
      setMock(await mockApi.finish(mock.id));
      void refresh();
    } catch (err) {
      fail(err, "Could not finish.");
    } finally {
      setBusy("");
    }
  };

  const turn: MockTurn | undefined = mock?.turns[index];
  const allAnswered = mock?.turns.every((t) => t.answer) ?? false;

  // ---------------------------------------------------------------- start screen
  if (!mock) {
    return (
      <PageTransition className="space-y-8">
        <PageHeader
          eyebrow="Practice"
          title="Practise an interview"
          description="Vren asks you questions for your job. You answer, and it tells you how to make each answer better."
        />
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-5 rounded-xl border bg-card p-5">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Job</span>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-base md:h-9 md:text-sm"
              >
                <option value="">Any role</option>
                {activeJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                    {j.company ? ` · ${j.company}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Kind of interview</legend>
              <div className="flex flex-wrap gap-1.5">
                {INTERVIEW_TYPES.filter((t) => t !== "Custom").map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={type === t}
                    onClick={() => setType(t)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm",
                      type === t
                        ? "border-primary bg-primary-soft/80 font-medium text-primary"
                        : "bg-card text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">How many questions: {count}</span>
              <input
                type="range"
                min={3}
                max={8}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <Button onClick={begin} disabled={busy === "making"}>
              {busy === "making" ? "Getting your questions…" : "Start practising"}
            </Button>
          </div>

          <aside className="space-y-2 rounded-xl border bg-card p-5 text-sm">
            <p className="font-medium">Earlier practice</p>
            {past.length === 0 ? (
              <p className="text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="space-y-2">
                {past.slice(0, 6).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => resume(m)}
                      className="min-w-0 text-left hover:underline"
                    >
                      <span className="block truncate">{m.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.state === "finished" && m.summary
                          ? `Score ${m.summary.average_score}/5`
                          : "In progress"}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${m.title}`}
                      className="text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => void mockApi.remove(m.id).then(refresh)}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </PageTransition>
    );
  }

  // ---------------------------------------------------------------- summary
  if (mock.state === "finished" && mock.summary) {
    const s = mock.summary;
    return (
      <PageTransition className="space-y-6">
        <PageHeader eyebrow="Practice" title="How it went" description={mock.title} />
        <div className="panel space-y-4 p-5">
          <p className="text-3xl font-semibold tabular">
            {s.average_score}
            <span className="text-base text-muted-foreground"> / 5 on average</span>
          </p>
          <p className="text-base leading-relaxed">{s.overall}</p>
          <div className="grid gap-4 md:grid-cols-3">
            <List title="Went well" items={s.strengths} />
            <List title="Change next time" items={s.fixes} />
            <List title="Practise" items={s.practise} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setMock(null)}>Practise again</Button>
        </div>
      </PageTransition>
    );
  }

  // ---------------------------------------------------------------- one question
  return (
    <PageTransition className="space-y-6">
      <PageHeader eyebrow={`Question ${index + 1} of ${mock.turns.length}`} title={mock.title} />
      {!turn ? (
        <EmptyState title="No questions." />
      ) : (
        <div className="space-y-4">
          <article className="panel space-y-2 p-5">
            <Status>{turn.kind}</Status>
            <p className="text-xl leading-snug">{turn.question}</p>
          </article>

          {!turn.feedback ? (
            <div className="space-y-3">
              <label htmlFor="mock-answer" className="text-sm font-medium">
                Your answer
              </label>
              <Textarea
                id="mock-answer"
                rows={7}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Say it the way you would in the interview."
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={submit} disabled={busy === "checking" || text.trim().length < 3}>
                  {busy === "checking" ? "Checking…" : "Check my answer"}
                </Button>
                {dictation.supported && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={dictation.listening ? dictation.stop : dictation.start}
                  >
                    <MicrophoneIcon className="size-4" aria-hidden="true" />
                    {dictation.listening ? "Stop speaking" : "Speak your answer"}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <article className="panel space-y-3 p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Your answer</p>
                  <Status tone={scoreTone(turn.feedback.score)}>{turn.feedback.score} / 5</Status>
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{turn.answer}</p>
              </article>
              <div className="grid gap-4 md:grid-cols-2">
                <List title="Went well" items={turn.feedback.did_well} />
                <List title="Do this next time" items={turn.feedback.improve} />
              </div>
              {turn.feedback.stronger_answer && (
                <article className="rounded-xl border border-primary/25 bg-primary-soft/40 p-5">
                  <p className="eyebrow mb-1.5">A stronger way to say it</p>
                  <p className="leading-relaxed">{turn.feedback.stronger_answer}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Written only from your CV. Nothing is made up.
                  </p>
                </article>
              )}
              <div className="flex gap-2">
                {index < mock.turns.length - 1 ? (
                  <Button
                    onClick={() => {
                      setIndex(index + 1);
                      setText("");
                    }}
                  >
                    Next question
                  </Button>
                ) : null}
                {(allAnswered || index === mock.turns.length - 1) && (
                  <Button
                    variant={index < mock.turns.length - 1 ? "outline" : "default"}
                    onClick={finish}
                    disabled={busy === "finishing"}
                  >
                    {busy === "finishing" ? "Wrapping up…" : "Finish"}
                  </Button>
                )}
              </div>
            </div>
          )}
          {!turn.feedback && mock.turns.some((t) => t.feedback) && (
            <Button variant="ghost" size="sm" onClick={finish} disabled={busy === "finishing"}>
              Finish now
            </Button>
          )}
        </div>
      )}
    </PageTransition>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="panel p-4">
      <p className="eyebrow mb-1.5">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to add.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((i) => (
            <li key={i}>• {i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
