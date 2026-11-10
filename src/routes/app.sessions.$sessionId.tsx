import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState, PageHeader, Status } from "@/components/vren";
import { setState, useAppState, type Session } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/sessions/$sessionId")({
  head: () => ({
    meta: [
      { title: "Session review — Vren AI" },
      { name: "description", content: "Questions, suggestions, evidence, notes and coaching feedback." },
      { property: "og:title", content: "Session review — Vren AI" },
      { property: "og:description", content: "Review a past interview session." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SessionReview,
});

const FEEDBACK = ["Useful", "Not useful", "Incorrect evidence"];

function SessionReview() {
  const { sessionId } = Route.useParams();
  const { sessions, jobs } = useAppState();
  const navigate = useNavigate();
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) return <EmptyState title="Session not found."><Link to="/app/sessions" className="text-primary">Back</Link></EmptyState>;
  const job = jobs.find((j) => j.id === s.jobId);
  const patch = (p: Partial<Session>) => setState((st) => ({ ...st, sessions: st.sessions.map((x) => (x.id === s.id ? { ...x, ...p } : x)) }));

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={format(new Date(s.date), "d MMM yyyy, HH:mm")}
        title={job?.title ?? "Session"}
        description="Feedback here is coaching, not an objective hiring assessment."
        actions={!s.reviewed ? <Button variant="outline" onClick={() => patch({ reviewed: true })}>Mark reviewed</Button> : <Status tone="brand">Reviewed</Status>}
      />

      <section className="grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4">
        {[
          ["Duration", `${s.durationMin} min`],
          ["State", s.state === "completed" ? "Completed" : "Interrupted"],
          ["Questions", String(s.questions.length)],
          ["Transcript", s.transcriptRetained ? "Retained" : "Not retained"],
        ].map(([k, v]) => (
          <div key={k} className="bg-card p-4">
            <p className="eyebrow">{k}</p>
            <p className="mt-1 font-semibold">{v}</p>
          </div>
        ))}
      </section>

      {s.state === "interrupted" && (
        <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning">This session was interrupted before finalisation. Only what was recorded before the disconnect is shown.</p>
      )}

      <section className="space-y-4">
        <h2 className="font-semibold">Questions & suggestions</h2>
        {s.questions.length === 0 && <EmptyState title="No questions were detected." />}
        {s.questions.map((q, i) => (
          <article key={i} className="panel space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">"{q.q}"</p>
              <Status>{q.type}</Status>
            </div>
            <ul className="space-y-1 border-l-2 border-primary pl-4 text-sm">{q.outline.map((o) => <li key={o}>{o}</li>)}</ul>
            <p className="text-xs text-muted-foreground">{q.evidence}</p>
            <div className="flex flex-wrap gap-1.5 border-t pt-3">
              {FEEDBACK.map((f) => (
                <button
                  key={f}
                  aria-pressed={q.feedback === f}
                  onClick={() => patch({ questions: s.questions.map((x, j) => (j === i ? { ...x, feedback: f } : x)) })}
                  className={cn("rounded-md border px-2.5 py-1 text-xs", q.feedback === f ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted")}
                >
                  {f}
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>

      {s.questions.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="panel p-5">
            <p className="eyebrow mb-2">Strengths</p>
            <p className="text-sm">Strong, quantified evidence for impact questions.</p>
          </div>
          <div className="panel p-5">
            <p className="eyebrow mb-2">Improve</p>
            <p className="text-sm">Add a concrete design-system adoption example to your profile.</p>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Private notes</h2>
        <Textarea rows={4} value={s.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="Only you can see these." />
      </section>

      <section className="flex items-center justify-between rounded-lg border border-destructive/30 p-5">
        <div>
          <p className="font-medium">Delete session</p>
          <p className="text-sm text-muted-foreground">Removes questions, suggestions, notes and any retained transcript.</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="destructive">Delete</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this session?</AlertDialogTitle>
              <AlertDialogDescription>This can't be undone. Your profile and job are not affected.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  setState((st) => ({ ...st, sessions: st.sessions.filter((x) => x.id !== s.id) }));
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
    </div>
  );
}
