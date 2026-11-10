import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, Status } from "@/components/vren";
import { matchJob, setState, useAppState, type Job } from "@/lib/store";

export const Route = createFileRoute("/app/jobs/$jobId")({
  head: () => ({
    meta: [
      { title: "Job detail — Vren AI" },
      { name: "description", content: "Requirements, matched evidence and gaps for this job." },
      { property: "og:title", content: "Job detail — Vren AI" },
      { property: "og:description", content: "How your profile maps to this job." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JobDetail,
});

function JobDetail() {
  const { jobId } = Route.useParams();
  const { jobs, profile } = useAppState();
  const job = jobs.find((j) => j.id === jobId);
  const [editing, setEditing] = useState(false);
  const [reqText, setReqText] = useState("");
  if (!job) return <EmptyState title="Job not found."><Link to="/app/jobs" className="text-primary">Back to jobs</Link></EmptyState>;

  const patch = (p: Partial<Job>) => setState((s) => ({ ...s, jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, ...p, updatedAt: new Date().toISOString() } : j)) }));
  const matches = matchJob(job, profile);
  const group = (st: string) => matches.filter((m) => m.state === st);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={job.company}
        title={job.title}
        actions={
          <>
            <Button variant="outline" onClick={() => patch({ archived: !job.archived })}>{job.archived ? "Restore" : "Archive"}</Button>
            <Button asChild><Link to="/app/prepare" search={{ job: job.id }}>Prepare for this job</Link></Button>
          </>
        }
      />

      <section className="grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-3">
        {([
          ["matched", "Matched evidence", "success"],
          ["partial", "Partial matches", "warning"],
          ["gap", "Gaps", "error"],
        ] as const).map(([k, label, tone]) => (
          <div key={k} className="bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">{label}</p>
              <span className="font-mono text-xs text-muted-foreground">{group(k).length}</span>
            </div>
            <ul className="space-y-1.5">
              {group(k).map((m) => <li key={m.req}><Status tone={tone}>{m.req}</Status></li>)}
              {group(k).length === 0 && <li className="text-xs text-muted-foreground">None</li>}
            </ul>
          </div>
        ))}
      </section>
      <p className="text-xs text-muted-foreground">Gaps are shown honestly. Vren will not invent experience to cover them — add real evidence to your profile instead.</p>

      <section className="panel space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Requirements</h2>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(!editing); setReqText(job.required.join(", ")); }}>{editing ? "Done" : "Edit"}</Button>
        </div>
        {editing ? (
          <Input value={reqText} onChange={(e) => { setReqText(e.target.value); patch({ required: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }); }} />
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">{job.required.map((r) => <li key={r} className="rounded border px-2 py-0.5">{r}</li>)}</ul>
        )}
        {job.preferred.length > 0 && (
          <div>
            <p className="eyebrow mb-2">Preferred</p>
            <ul className="flex flex-wrap gap-2 text-sm">{job.preferred.map((r) => <li key={r} className="rounded border border-dashed px-2 py-0.5 text-muted-foreground">{r}</li>)}</ul>
          </div>
        )}
        {job.themes.length > 0 && (
          <div>
            <p className="eyebrow mb-2">Likely interview themes</p>
            <p className="text-sm">{job.themes.join(" · ")}</p>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Job description</h2>
        <Textarea rows={8} value={job.description} onChange={(e) => patch({ description: e.target.value })} />
      </section>
    </div>
  );
}
