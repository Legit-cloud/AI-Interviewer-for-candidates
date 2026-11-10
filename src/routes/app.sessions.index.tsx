import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { EmptyState, PageHeader, Status } from "@/components/vren";
import { useAppState } from "@/lib/store";

export const Route = createFileRoute("/app/sessions/")({
  head: () => ({
    meta: [
      { title: "Session history — Vren AI" },
      { name: "description", content: "Past interview sessions, retention state and review status." },
      { property: "og:title", content: "Session history — Vren AI" },
      { property: "og:description", content: "Your interview session history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Sessions,
});

function Sessions() {
  const { sessions, jobs } = useAppState();
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="History" title="Sessions" description="Interrupted sessions are kept and labelled, never silently hidden." />
      {sessions.length === 0 ? (
        <EmptyState title="No sessions yet." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr className="eyebrow">
                {["Date", "Job", "Duration", "State", "Transcript", "Review"].map((h) => <th key={h} className="px-5 py-2.5 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-muted">
                  <td className="px-5 py-3 font-mono text-xs">
                    <Link to="/app/sessions/$sessionId" params={{ sessionId: s.id }} className="hover:underline">{format(new Date(s.date), "d MMM yyyy, HH:mm")}</Link>
                  </td>
                  <td className="px-5 py-3">{jobs.find((j) => j.id === s.jobId)?.title ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-xs">{s.durationMin} min</td>
                  <td className="px-5 py-3">{s.state === "completed" ? <Status tone="success">Completed</Status> : <Status tone="warning">Interrupted — review available</Status>}</td>
                  <td className="px-5 py-3 text-muted-foreground">{s.transcriptRetained ? "Retained" : "Not retained"}</td>
                  <td className="px-5 py-3">{s.reviewed ? <Status tone="brand">Reviewed</Status> : <Status>Pending</Status>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
