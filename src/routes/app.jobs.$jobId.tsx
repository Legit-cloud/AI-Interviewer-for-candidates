import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageTransition } from "@/components/motion";
import { EmptyState, PageHeader, Status } from "@/components/vren";
import { deleteJob, matchJob, updateJob, useAppState } from "@/lib/store";

export const Route = createFileRoute("/app/jobs/$jobId")({
  head: () => ({
    meta: [
      { title: "Job detail | Vren AI" },
      { name: "description", content: "Requirements, matched evidence and gaps for this job." },
      { property: "og:title", content: "Job detail | Vren AI" },
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
  const navigate = useNavigate();
  const job = jobs.find((j) => j.id === jobId);
  const [editing, setEditing] = useState(false);
  const [reqText, setReqText] = useState("");
  const [prefText, setPrefText] = useState("");
  const [themeText, setThemeText] = useState("");

  if (!job) {
    return (
      <EmptyState title="Job not found.">
        <Button variant="outline" size="sm" asChild>
          <Link to="/app/jobs">Back to jobs</Link>
        </Button>
      </EmptyState>
    );
  }

  const matches = matchJob(job, profile);
  const group = (st: "matched" | "partial" | "gap") => matches.filter((m) => m.state === st);

  const toggleEdit = () => {
    if (!editing) {
      setReqText(job.required.join(", "));
      setPrefText(job.preferred.join(", "));
      setThemeText(job.themes.join(", "));
    }
    setEditing(!editing);
  };

  const splitCsv = (v: string) =>
    v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  return (
    <PageTransition className="space-y-8">
      <PageHeader
        eyebrow={`${job.company} · ${job.seniority}${job.archived ? " · Archived" : ""}`}
        title={job.title}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                updateJob(job.id, { archived: !job.archived });
                toast(job.archived ? "Job restored." : "Job archived. Historical sessions stay intact.");
              }}
            >
              {job.archived ? (
                <>
                  <ArrowCounterClockwiseIcon className="size-4" aria-hidden="true" />
                  Restore
                </>
              ) : (
                <>
                  <ArchiveIcon className="size-4" aria-hidden="true" />
                  Archive
                </>
              )}
            </Button>
            {!job.archived && (
              <Button asChild>
                <Link to="/app/prepare" search={{ job: job.id }}>
                  Prepare for this job
                  <ArrowRightIcon className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* Profile comparison */}
      <section className="space-y-3">
        <div className="grid gap-4 md:grid-cols-3">
          {(
            [
              ["matched", "Matched evidence", "success"],
              ["partial", "Partial matches", "warning"],
              ["gap", "Honest gaps", "error"],
            ] as const
          ).map(([k, label, tone]) => (
            <div key={k} className="panel p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">{label}</p>
                <span className="font-mono text-xs text-muted-foreground tabular">
                  {group(k).length}
                </span>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {group(k).map((m) => (
                  <li key={m.req}>
                    <Status tone={tone}>
                      {m.req}
                      {!m.required ? " (pref)" : ""}
                    </Status>
                  </li>
                ))}
                {group(k).length === 0 && <li className="text-xs text-muted-foreground">None</li>}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            Gaps are shown honestly. Vren AI never invents experience to cover them; add real
            evidence in your profile instead.
          </p>
          <Link to="/app/profile" className="font-medium text-primary hover:underline">
            Update profile evidence →
          </Link>
        </div>
      </section>

      {/* Structured requirements */}
      <section className="panel space-y-5 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Extracted job context</h2>
          <Button size="sm" variant="ghost" onClick={toggleEdit}>
            <PencilSimpleIcon className="size-4" aria-hidden="true" />
            {editing ? "Done" : "Edit fields"}
          </Button>
        </div>

        {editing ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="eyebrow">Required skills (comma-separated)</p>
              <Input
                value={reqText}
                onChange={(e) => {
                  setReqText(e.target.value);
                  updateJob(job.id, { required: splitCsv(e.target.value) });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <p className="eyebrow">Preferred skills (comma-separated)</p>
              <Input
                value={prefText}
                onChange={(e) => {
                  setPrefText(e.target.value);
                  updateJob(job.id, { preferred: splitCsv(e.target.value) });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <p className="eyebrow">Likely interview themes (comma-separated)</p>
              <Input
                value={themeText}
                onChange={(e) => {
                  setThemeText(e.target.value);
                  updateJob(job.id, { themes: splitCsv(e.target.value) });
                }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="eyebrow mb-2">Required</p>
              <ul className="flex flex-wrap gap-1.5 text-sm">
                {job.required.map((r) => (
                  <li key={r} className="rounded-md border bg-background px-2.5 py-1 text-xs font-medium">
                    {r}
                  </li>
                ))}
                {job.required.length === 0 && (
                  <li className="text-xs text-muted-foreground">No required skills parsed yet.</li>
                )}
              </ul>
            </div>

            {job.preferred.length > 0 && (
              <div>
                <p className="eyebrow mb-2">Preferred</p>
                <ul className="flex flex-wrap gap-1.5 text-sm">
                  {job.preferred.map((r) => (
                    <li
                      key={r}
                      className="rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {job.responsibilities.length > 0 && (
              <div>
                <p className="eyebrow mb-2">Key responsibilities</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {job.responsibilities.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
              </div>
            )}

            {job.themes.length > 0 && (
              <div>
                <p className="eyebrow mb-2">Likely interview themes</p>
                <p className="text-sm text-foreground">{job.themes.join(" · ")}</p>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Canonical job description</h2>
        <Textarea
          rows={7}
          value={job.description}
          onChange={(e) => updateJob(job.id, { description: e.target.value })}
        />
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/4 p-5">
        <div>
          <p className="text-sm font-medium text-foreground">Delete job description</p>
          <p className="text-xs text-muted-foreground">
            Archive instead if you want to keep session references cleanly labelled.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <TrashIcon className="size-4" aria-hidden="true" />
              Delete job
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {job.title}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the job description permanently. Consider archiving instead to preserve
                session links.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  deleteJob(job.id);
                  toast("Job deleted.");
                  navigate({ to: "/app/jobs" });
                }}
              >
                Delete job
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </PageTransition>
  );
}
