import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/vren";
import { matchJob, setState, useAppState, type PrepConfig } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/prepare")({
  validateSearch: (s: Record<string, unknown>): { job?: string | undefined } => ({ job: typeof s["job"] === "string" ? (s["job"] as string) : undefined }),
  head: () => ({
    meta: [
      { title: "Prepare an interview — Vren AI" },
      { name: "description", content: "Choose job, interview type, response style and retention before going live." },
      { property: "og:title", content: "Prepare an interview — Vren AI" },
      { property: "og:description", content: "Configure your live assistant." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Prepare,
});

const OPTIONS = {
  interviewType: ["Behavioural", "Technical", "Case", "System design", "General", "Custom"],
  length: ["Brief", "Standard", "Detailed"],
  style: ["Direct", "Conversational", "Structured", "Coaching"],
  framework: ["STAR", "Problem / approach / trade-off", "Situation / decision / result", "None"],
} as const;

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={cn("rounded-md border px-3 py-1.5 text-sm", value === o ? "border-primary bg-primary/5 font-medium text-primary" : "bg-card hover:bg-muted")}
          >
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Prepare() {
  const { job: jobParam } = Route.useSearch();
  const { profile, jobs, prep, extension } = useAppState();
  const active = jobs.filter((j) => !j.archived);
  const [cfg, setCfg] = useState<PrepConfig>(
    prep ?? { jobId: jobParam ?? active[0]?.id ?? "", interviewType: "Behavioural", language: "English", length: "Brief", style: "Structured", framework: "STAR", retainTranscript: false, notes: true },
  );
  const jobId = jobParam && !prep ? jobParam : cfg.jobId;
  const job = jobs.find((j) => j.id === jobId);
  const set = (p: Partial<PrepConfig>) => setCfg((c) => ({ ...c, ...p }));
  const gaps = job ? matchJob(job, profile).filter((m) => m.state === "gap").length : 0;

  const checks = [
    { ok: (profile?.experience.length ?? 0) > 0, label: "Candidate evidence added", warn: "Add experience so suggestions can cite your background." },
    { ok: !!profile?.experience.every((e) => e.origin === "verified"), label: "Profile verified", warn: "Some fields are extracted but unverified." },
    { ok: !!job && job.required.length > 0, label: "Job requirements present", warn: "Choose a job with requirements." },
    { ok: extension.connected, label: "Chrome extension connected", warn: "Connect the extension from the dashboard." },
  ];

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Preparation workspace" title="Set up your live assistant" description="These settings are snapshotted into the session so later edits won't change its meaning." />
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="panel space-y-6 p-6">
          <div className="space-y-2">
            <Label htmlFor="job">Job description</Label>
            <select id="job" value={jobId} onChange={(e) => set({ jobId: e.target.value })} className="h-9 w-full rounded-md border bg-card px-3 text-sm">
              {active.length === 0 && <option value="">No jobs — create one first</option>}
              {active.map((j) => <option key={j.id} value={j.id}>{j.title} · {j.company}</option>)}
            </select>
          </div>
          <Segmented label="Interview type" value={cfg.interviewType} options={OPTIONS.interviewType} onChange={(v) => set({ interviewType: v })} />
          <Segmented label="Answer length" value={cfg.length} options={OPTIONS.length} onChange={(v) => set({ length: v })} />
          <Segmented label="Response style" value={cfg.style} options={OPTIONS.style} onChange={(v) => set({ style: v })} />
          <Segmented label="Answer framework" value={cfg.framework} options={OPTIONS.framework} onChange={(v) => set({ framework: v })} />
          <div className="space-y-3 border-t pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="retain">Keep transcript after the session</Label>
                <p className="text-xs text-muted-foreground">Off by default. Raw audio is never retained.</p>
              </div>
              <Switch id="retain" checked={cfg.retainTranscript} onCheckedChange={(v) => set({ retainTranscript: v })} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="notes">Enable session notes</Label>
              <Switch id="notes" checked={cfg.notes} onCheckedChange={(v) => set({ notes: v })} />
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="panel p-5">
            <p className="eyebrow mb-3">Preflight</p>
            <ul className="space-y-3 text-sm">
              {checks.map((c) => (
                <li key={c.label} className="flex gap-2">
                  {c.ok ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />}
                  <div>
                    <p className={c.ok ? "" : "font-medium"}>{c.label}</p>
                    {!c.ok && <p className="text-xs text-muted-foreground">{c.warn}</p>}
                  </div>
                </li>
              ))}
            </ul>
            {gaps > 0 && <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">{gaps} requirement gap{gaps > 1 ? "s" : ""} — <Link to="/app/jobs/$jobId" params={{ jobId }} className="text-primary">view</Link></p>}
          </div>
          <Button
            className="w-full"
            size="lg"
            disabled={!job}
            onClick={() => {
              setState((s) => ({ ...s, prep: { ...cfg, jobId } }));
              toast.success("Preparation saved. Open the Vren AI side panel on your meeting tab to start.");
            }}
          >
            Open live assistant
          </Button>
          <p className="text-center text-xs text-muted-foreground">Capture only starts when you press Start in the extension.</p>
        </aside>
      </div>
    </div>
  );
}
