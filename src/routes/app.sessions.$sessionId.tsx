import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  CheckCircleIcon,
  DownloadSimpleIcon,
  InfoIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageTransition } from "@/components/motion";
import { EmptyState, PageHeader, Status } from "@/components/vren";
import {
  deleteSession,
  setSuggestionFeedback,
  updateSession,
  useAppState,
  type SuggestionFeedback,
} from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/sessions/$sessionId")({
  head: () => ({
    meta: [
      { title: "Session review | Vren AI" },
      { name: "description", content: "Questions, suggestions, evidence, notes and coaching feedback." },
      { property: "og:title", content: "Session review | Vren AI" },
      { property: "og:description", content: "Review a past interview session." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SessionReview,
});

const FEEDBACK_OPTIONS: { id: SuggestionFeedback; label: string; icon: typeof ThumbsUpIcon }[] = [
  { id: "useful", label: "Useful", icon: ThumbsUpIcon },
  { id: "not_useful", label: "Not useful", icon: ThumbsDownIcon },
  { id: "incorrect", label: "Incorrect evidence", icon: WarningCircleIcon },
];

function SessionReview() {
  const { sessionId } = Route.useParams();
  const { sessions, jobs } = useAppState();
  const navigate = useNavigate();
  const s = sessions.find((x) => x.id === sessionId);

  if (!s) {
    return (
      <EmptyState title="Session not found.">
        <Button variant="outline" size="sm" asChild>
          <Link to="/app/sessions">Back to sessions</Link>
        </Button>
      </EmptyState>
    );
  }

  const job = jobs.find((j) => j.id === s.jobId);

  const exportOne = () => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vren-session-${s.id}.json`;
    a.click();
  };

  return (
    <PageTransition className="space-y-9">
      <PageHeader
        eyebrow={format(new Date(s.date), "d MMM yyyy, HH:mm")}
        title={job ? `${job.title} · ${job.company}` : "Interview session"}
        description="Coaching insights are meant to support reflection, never an objective hiring assessment."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportOne}>
              <DownloadSimpleIcon className="size-4" aria-hidden="true" />
              Export
            </Button>
            {s.reviewed ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateSession(s.id, { reviewed: false })}
              >
                <CheckCircleIcon className="size-4 text-primary" weight="fill" aria-hidden="true" />
                Reviewed
              </Button>
            ) : (
              <Button size="sm" onClick={() => updateSession(s.id, { reviewed: true })}>
                Mark reviewed
              </Button>
            )}
          </>
        }
      />

      {/* Summary & Snapshot */}
      <section className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {[
            ["Duration", `${s.durationMin} min`],
            ["State", s.state === "completed" ? "Completed" : "Interrupted"],
            ["Questions", String(s.questions.length)],
            ["Transcript", s.transcriptRetained ? "Retained" : "Not retained"],
          ].map(([k, v]) => (
            <div key={k} className="panel p-4">
              <p className="eyebrow">{k}</p>
              <p className="mt-1.5 text-base font-semibold text-foreground tabular">{v}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="eyebrow mr-1">Snapshot</span>
          {[
            s.snapshot.interviewType,
            s.snapshot.framework,
            s.snapshot.length,
            s.snapshot.style,
            s.snapshot.language,
          ].map((tag) => (
            <span key={tag} className="rounded-full border bg-card px-2.5 py-0.5 font-mono text-[11px]">
              {tag}
            </span>
          ))}
        </div>
      </section>

      {s.state === "interrupted" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/35 bg-warning/8 p-4 text-sm text-warning">
          <WarningCircleIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden="true" />
          <p>
            This session ended due to an interruption before finalisation. Only items recorded prior
            to the disconnect are shown.
          </p>
        </div>
      )}

      {/* Questions & Suggestions */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Questions & live suggestions</h2>
        {s.questions.length === 0 ? (
          <EmptyState title="No questions were detected before the session ended." />
        ) : (
          s.questions.map((q) => (
            <article key={q.id} className="panel space-y-3.5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span>{q.askedAt}</span>
                    <span>·</span>
                    <span>{q.framework}</span>
                  </div>
                  <p className="text-base font-medium text-foreground">“{q.q}”</p>
                </div>
                <Status>{q.type}</Status>
              </div>

              <ul className="space-y-1.5 border-l-2 border-primary pl-4 text-sm text-foreground">
                {q.outline.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>

              {q.evidence ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircleIcon
                    className="size-4 shrink-0 text-success"
                    weight="fill"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="font-medium text-foreground">Evidence used:</strong>{" "}
                    {q.evidence}
                  </span>
                </p>
              ) : (
                <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning">
                  <WarningCircleIcon className="size-4 shrink-0" weight="fill" aria-hidden="true" />
                  No matching evidence found in your verified profile.
                </p>
              )}

              {q.caveat && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <InfoIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  {q.caveat}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
                <span className="mr-1 font-mono text-[11px] text-muted-foreground">
                  Rate suggestion:
                </span>
                {FEEDBACK_OPTIONS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={q.feedback === id}
                    onClick={() => setSuggestionFeedback(s.id, q.id, id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                      q.feedback === id
                        ? id === "incorrect"
                          ? "border-destructive/40 bg-destructive/10 font-medium text-destructive"
                          : "border-primary bg-primary-soft/80 font-medium text-primary"
                        : "bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
            </article>
          ))
        )}
      </section>

      {/* Coaching Insights */}
      {(s.strengths.length > 0 || s.improvements.length > 0 || s.missedEvidence.length > 0) && (
        <section className="grid gap-4 md:grid-cols-3">
          <div className="panel p-5">
            <p className="eyebrow mb-2.5 text-success">Strengths</p>
            <ul className="space-y-1.5 text-sm text-foreground">
              {s.strengths.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
          <div className="panel p-5">
            <p className="eyebrow mb-2.5">Areas to refine</p>
            <ul className="space-y-1.5 text-sm text-foreground">
              {s.improvements.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
          <div className="panel p-5">
            <p className="eyebrow mb-2.5 text-copper">Missed evidence</p>
            {s.missedEvidence.length > 0 ? (
              <ul className="space-y-1.5 text-sm text-foreground">
                {s.missedEvidence.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None flagged.</p>
            )}
          </div>
        </section>
      )}

      {/* Transcript (Consent-gated per FR-10) */}
      <section className="panel space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Transcript</h2>
          <Status tone={s.transcriptRetained ? "brand" : "neutral"}>
            {s.transcriptRetained ? "Retained with consent" : "Discarded"}
          </Status>
        </div>
        {s.transcriptRetained && s.transcript.length > 0 ? (
          <ul className="space-y-2 border-t pt-3 font-mono text-xs leading-relaxed">
            {s.transcript.map((line, idx) => (
              <li key={idx} className="flex gap-3">
                <span className="shrink-0 text-muted-foreground tabular">{line.t}</span>
                <span>
                  <strong className="font-semibold text-foreground">{line.speaker}:</strong>{" "}
                  <span className="text-muted-foreground">{line.text}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Transcript was not retained for this session per your privacy selection.
          </p>
        )}
      </section>

      {/* Private Notes */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Private notes</h2>
        <Textarea
          rows={4}
          value={s.notes}
          onChange={(e) => updateSession(s.id, { notes: e.target.value })}
          placeholder="Add follow-up thoughts, interviewer questions, or points to verify. Saved automatically."
        />
      </section>

      {/* Danger Zone */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/4 p-5">
        <div>
          <p className="text-sm font-medium text-foreground">Delete session</p>
          <p className="text-xs text-muted-foreground">
            Permanently removes questions, suggestions, notes, and any retained transcript.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <TrashIcon className="size-4" aria-hidden="true" />
              Delete session
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this session?</AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone. Your candidate profile and job descriptions are unaffected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  deleteSession(s.id);
                  toast("Session deleted.");
                  navigate({ to: "/app/sessions" });
                }}
              >
                Delete session
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </PageTransition>
  );
}
