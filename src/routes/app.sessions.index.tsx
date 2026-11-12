import { createFileRoute, Link } from "@tanstack/react-router";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { format } from "date-fns";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/loading";
import { PageTransition } from "@/components/motion";
import { EmptyState, PageHeader, Status } from "@/components/vren";
import { useAppState } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/sessions/")({
  head: () => ({
    meta: [
      { title: "Session history | Vren AI" },
      { name: "description", content: "Past interview sessions, retention state and review status." },
      { property: "og:title", content: "Session history | Vren AI" },
      { property: "og:description", content: "Your interview session history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Sessions,
  pendingComponent: () => <ListSkeleton rows={3} />,
});

type Filter = "all" | "completed" | "interrupted" | "unreviewed";

function Sessions() {
  const { sessions, jobs } = useAppState();
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = sessions.filter((s) => {
    if (filter === "completed") return s.state === "completed";
    if (filter === "interrupted") return s.state === "interrupted";
    if (filter === "unreviewed") return !s.reviewed;
    return true;
  });

  return (
    <PageTransition className="space-y-8">
      <PageHeader
        eyebrow="History"
        title="Sessions"
        description="Interrupted sessions are kept and clearly labelled, never silently hidden or marked complete."
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/prepare">New preparation</Link>
          </Button>
        }
      />

      {sessions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `All (${sessions.length})`],
              ["completed", `Completed (${sessions.filter((s) => s.state === "completed").length})`],
              ["interrupted", `Interrupted (${sessions.filter((s) => s.state === "interrupted").length})`],
              ["unreviewed", `Needs review (${sessions.filter((s) => !s.reviewed).length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                filter === id
                  ? "border-ink bg-ink text-ink-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClockCounterClockwiseIcon className="size-5" aria-hidden="true" />}
          title={sessions.length === 0 ? "No sessions yet." : "No sessions match this filter."}
          description="Prepare an interview and run the companion preview to record a session."
        >
          <Button variant="outline" size="sm" asChild>
            <Link to="/app/prepare">Prepare an interview</Link>
          </Button>
        </EmptyState>
      ) : (
        <>
          {/* Mobile card list */}
          <ul className="space-y-3 md:hidden">
            {filtered.map((s) => {
              const job = jobs.find((j) => j.id === s.jobId);
              return (
                <li key={s.id}>
                  <Link
                    to="/app/sessions/$sessionId"
                    params={{ sessionId: s.id }}
                    className="panel block space-y-2.5 p-4 active:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">
                          {job ? `${job.title} · ${job.company}` : "Untitled role"}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground tabular">
                          {format(new Date(s.date), "d MMM yyyy, HH:mm")} · {s.durationMin} min
                        </p>
                      </div>
                      {s.reviewed ? <Status tone="brand">Reviewed</Status> : <Status>Pending</Status>}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      {s.state === "completed" ? (
                        <Status tone="success">Completed</Status>
                      ) : (
                        <Status tone="warning">Interrupted · review available</Status>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {s.transcriptRetained ? "Transcript retained" : "Transcript discarded"}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Desktop table */}
          <div className="panel hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/60 text-left">
                <tr className="eyebrow">
                  {["Date", "Job", "Duration", "State", "Transcript", "Review"].map((h) => (
                    <th key={h} className="px-5 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((s) => {
                  const job = jobs.find((j) => j.id === s.jobId);
                  return (
                    <tr key={s.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-5 py-3.5 font-mono text-xs tabular">
                        <Link
                          to="/app/sessions/$sessionId"
                          params={{ sessionId: s.id }}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {format(new Date(s.date), "d MMM yyyy, HH:mm")}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5">
                        <Link
                          to="/app/sessions/$sessionId"
                          params={{ sessionId: s.id }}
                          className="hover:underline"
                        >
                          {job ? `${job.title} · ${job.company}` : "Untitled role"}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground tabular">
                        {s.durationMin} min
                      </td>
                      <td className="px-5 py-3.5">
                        {s.state === "completed" ? (
                          <Status tone="success">Completed</Status>
                        ) : (
                          <Status tone="warning">Interrupted · review available</Status>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">
                        {s.transcriptRetained ? "Retained" : "Not retained"}
                      </td>
                      <td className="px-5 py-3.5">
                        {s.reviewed ? <Status tone="brand">Reviewed</Status> : <Status>Pending</Status>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageTransition>
  );
}
