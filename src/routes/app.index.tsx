import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Status } from "@/components/vren";
import { profileCompleteness, setState, useAppState } from "@/lib/store";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Vren AI" },
      { name: "description", content: "Your profile, jobs, extension status and recent sessions." },
      { property: "og:title", content: "Dashboard — Vren AI" },
      { property: "og:description", content: "Your interview workspace overview." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { profile, jobs, sessions, extension } = useAppState();
  const active = jobs.filter((j) => !j.archived);
  const pct = profileCompleteness(profile);
  const hasContent = (profile?.experience.length ?? 0) > 0 || active.length > 0;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={format(new Date(), "EEEE, d MMMM")}
        title={`Good to see you, ${profile?.name.split(" ")[0] ?? ""}`}
        actions={
          <Button asChild>
            <Link to="/app/prepare">Prepare an interview <ArrowRight /></Link>
          </Button>
        }
      />

      {!hasContent && (
        <EmptyState title="Add a CV or create a job description to prepare your first session.">
          <Button size="sm" variant="outline" asChild><Link to="/app/profile">Add a CV</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="/app/jobs">Add a job</Link></Button>
        </EmptyState>
      )}

      <section className="grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-3">
        <div className="bg-card p-5">
          <p className="eyebrow">Active profile</p>
          <p className="mt-2 font-semibold">{profile?.name}</p>
          <p className="text-sm text-muted-foreground">{profile?.headline || "No headline yet"}</p>
          <div className="mt-4 h-1.5 rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 font-mono text-xs text-muted-foreground">{pct}% context complete</p>
          <Link to="/app/profile" className="mt-3 inline-block text-sm text-primary hover:underline">Review profile →</Link>
        </div>
        <div className="bg-card p-5">
          <p className="eyebrow">Next step</p>
          {profile?.experience.some((e) => e.origin !== "verified") ? (
            <>
              <p className="mt-2 font-semibold">Verify extracted fields</p>
              <p className="text-sm text-muted-foreground">Only verified context is used with confidence in live guidance.</p>
              <Link to="/app/profile/review" className="mt-3 inline-block text-sm text-primary hover:underline">Open CV review →</Link>
            </>
          ) : (
            <>
              <p className="mt-2 font-semibold">Run a preparation</p>
              <Link to="/app/prepare" className="mt-3 inline-block text-sm text-primary hover:underline">Prepare →</Link>
            </>
          )}
        </div>
        <div className="bg-card p-5">
          <p className="eyebrow">Chrome extension</p>
          <div className="mt-2">
            <Status tone={extension.connected ? "success" : "neutral"}>{extension.connected ? "Connected" : "Not connected"}</Status>
          </div>
          {extension.connected ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">v{extension.version}</p>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setState((s) => ({ ...s, extension: { connected: true, version: "1.0.0", connectedAt: new Date().toISOString() } }))}
            >
              Connect extension
            </Button>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-semibold">Recent jobs</h2>
          <Link to="/app/jobs" className="text-sm text-primary hover:underline">All jobs</Link>
        </div>
        {active.length === 0 ? (
          <EmptyState title="No jobs yet" />
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {active.slice(0, 4).map((j) => (
              <li key={j.id}>
                <Link to="/app/jobs/$jobId" params={{ jobId: j.id }} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted">
                  <span>
                    <span className="font-medium">{j.title}</span> <span className="text-muted-foreground">· {j.company}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{format(new Date(j.updatedAt), "d MMM")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-semibold">Recent sessions</h2>
          <Link to="/app/sessions" className="text-sm text-primary hover:underline">History</Link>
        </div>
        {sessions.length === 0 ? (
          <EmptyState title="No sessions yet. Your interviews will appear here." />
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {sessions.slice(0, 3).map((s) => (
              <li key={s.id}>
                <Link to="/app/sessions/$sessionId" params={{ sessionId: s.id }} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted">
                  <span className="text-sm">
                    {jobs.find((j) => j.id === s.jobId)?.title ?? "Untitled"} <span className="font-mono text-xs text-muted-foreground">· {s.durationMin} min</span>
                  </span>
                  {s.state === "completed" ? <Status tone="success">Completed</Status> : <Status tone="warning">Interrupted — review available</Status>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
