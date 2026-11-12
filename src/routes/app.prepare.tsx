import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { MonitorIcon } from "@phosphor-icons/react/Monitor";
import { PauseIcon } from "@phosphor-icons/react/Pause";
import { PlayIcon } from "@phosphor-icons/react/Play";
import { RadioIcon } from "@phosphor-icons/react/Radio";
import { SpeakerHighIcon } from "@phosphor-icons/react/SpeakerHigh";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DetailSkeleton } from "@/components/loading";
import { AnimatePresence, PageTransition, motion, EASE } from "@/components/motion";
import { PageHeader, Status } from "@/components/vren";
import {
  ANSWER_LENGTHS,
  createPracticeSessionAsync,
  FRAMEWORKS,
  INTERVIEW_TYPES,
  LANGUAGES,
  matchJob,
  RESPONSE_STYLES,
  savePrep,
  useAppState,
  type PrepConfig,
} from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/prepare")({
  validateSearch: (s: Record<string, unknown>): { job?: string | undefined } => ({
    job: typeof s["job"] === "string" ? (s["job"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Prepare an interview | Vren AI" },
      {
        name: "description",
        content: "Choose job, interview type, response style and retention before going live.",
      },
      { property: "og:title", content: "Prepare an interview | Vren AI" },
      { property: "og:description", content: "Configure your live assistant." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Prepare,
  pendingComponent: DetailSkeleton,
});

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
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{label}</legend>
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

type SimStage = "disclosure" | "listening" | "paused" | "ended";

function Prepare() {
  const { job: jobParam } = Route.useSearch();
  const navigate = useNavigate();
  const { profile, jobs, prep, preferences } = useAppState();
  const activeJobs = jobs.filter((j) => !j.archived);

  const [cfg, setCfg] = useState<PrepConfig>(
    prep ?? {
      jobId: jobParam ?? activeJobs[0]?.id ?? "",
      interviewType: "Behavioural",
      language: preferences.language,
      length: preferences.length,
      style: preferences.style,
      framework: preferences.framework,
      retainTranscript: preferences.retainTranscriptDefault,
      notes: preferences.notesDefault,
    },
  );

  const [simOpen, setSimOpen] = useState(false);
  const [simStage, setSimStage] = useState<SimStage>("disclosure");
  const [tabAudio, setTabAudio] = useState(true);
  const [micAudio, setMicAudio] = useState(false);

  const jobId = jobParam && !prep ? jobParam : cfg.jobId;
  const job = jobs.find((j) => j.id === jobId);
  const set = (p: Partial<PrepConfig>) => setCfg((c) => ({ ...c, ...p }));
  const gaps = job ? matchJob(job, profile).filter((m) => m.state === "gap").length : 0;

  const checks = [
    {
      ok: (profile?.experience.length ?? 0) > 0,
      label: "Candidate evidence added",
      warn: "Add experience so answers can cite your real background.",
    },
    {
      ok:
        (profile?.experience.length ?? 0) > 0 &&
        !!profile?.experience.every((e) => e.origin === "verified"),
      label: "Profile verified",
      warn: "Some fields are extracted but unverified.",
    },
    {
      ok: !!job && job.required.length > 0,
      label: "Job requirements present",
      warn: "Choose a job with extracted requirements.",
    },
  ];

  const openCompanion = () => {
    savePrep({ ...cfg, jobId });
    setSimStage("disclosure");
    setSimOpen(true);
    toast.success("Preparation snapshot saved.");
  };

  const saveSimulatedSession = async () => {
    if (!job) return;
    try {
      const id = await createPracticeSessionAsync(job, cfg);
      setSimOpen(false);
      toast.success("Practice session saved to history.");
      navigate({ to: "/app/sessions/$sessionId", params: { sessionId: id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save practice session.");
    }
  };

  return (
    <PageTransition className="space-y-8">
      <PageHeader
        eyebrow="Preparation workspace"
        title="Set up your live assistant"
        description="These settings are snapshotted into your session so later profile or preference edits never alter historical session meaning."
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="panel space-y-6 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="job">Target job description</Label>
              <select
                id="job"
                value={jobId}
                onChange={(e) => set({ jobId: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-base md:h-9 md:text-sm"
              >
                {activeJobs.length === 0 && <option value="">No active jobs (create one first)</option>}
                {activeJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} · {j.company}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lang">Response language</Label>
              <select
                id="lang"
                value={cfg.language}
                onChange={(e) => set({ language: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-base md:h-9 md:text-sm"
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Segmented
            label="Interview type"
            value={cfg.interviewType}
            options={INTERVIEW_TYPES}
            onChange={(v) => set({ interviewType: v })}
          />
          <Segmented
            label="Answer length"
            value={cfg.length}
            options={ANSWER_LENGTHS}
            onChange={(v) => set({ length: v })}
          />
          <Segmented
            label="Response style"
            value={cfg.style}
            options={RESPONSE_STYLES}
            onChange={(v) => set({ style: v })}
          />
          <Segmented
            label="Answer framework"
            value={cfg.framework}
            options={FRAMEWORKS}
            onChange={(v) => set({ framework: v })}
          />

          <div className="space-y-4 border-t pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="retain">Keep transcript after the session</Label>
                <p className="text-xs text-muted-foreground">
                  Off by default. Raw audio is never retained regardless of this choice.
                </p>
              </div>
              <Switch
                id="retain"
                checked={cfg.retainTranscript}
                onCheckedChange={(v) => set({ retainTranscript: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="notes">Enable session notes</Label>
                <p className="text-xs text-muted-foreground">
                  Allows adding private notes during post-session review.
                </p>
              </div>
              <Switch
                id="notes"
                checked={cfg.notes}
                onCheckedChange={(v) => set({ notes: v })}
              />
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="panel space-y-4 p-5">
            <p className="eyebrow">Preflight checklist</p>
            <ul className="space-y-3 text-sm">
              {checks.map((c) => (
                <li key={c.label} className="flex gap-2.5">
                  {c.ok ? (
                    <CheckCircleIcon
                      className="mt-0.5 size-4 shrink-0 text-success"
                      weight="fill"
                      aria-hidden="true"
                    />
                  ) : (
                    <WarningIcon
                      className="mt-0.5 size-4 shrink-0 text-warning"
                      weight="fill"
                      aria-hidden="true"
                    />
                  )}
                  <div>
                    <p className={c.ok ? "text-foreground" : "font-medium text-foreground"}>
                      {c.label}
                    </p>
                    {!c.ok && <p className="text-xs text-muted-foreground">{c.warn}</p>}
                  </div>
                </li>
              ))}
            </ul>

            {job && job.themes.length > 0 && (
              <div className="border-t pt-3">
                <p className="eyebrow mb-1.5">Likely themes</p>
                <p className="text-xs text-muted-foreground">{job.themes.join(" · ")}</p>
              </div>
            )}

            {gaps > 0 && job && (
              <p className="border-t pt-3 text-xs text-muted-foreground">
                {gaps} requirement {gaps === 1 ? "gap" : "gaps"} detected.{" "}
                <Link
                  to="/app/jobs/$jobId"
                  params={{ jobId: job.id }}
                  className="font-medium text-primary hover:underline"
                >
                  Inspect gaps →
                </Link>
              </p>
            )}
          </div>

          <Button className="w-full" size="lg" disabled={!job} onClick={openCompanion}>
            <RadioIcon className="size-4" aria-hidden="true" />
            Open live assistant
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Capture starts only after you disclose permissions and press Start in the Side Panel.
          </p>
        </aside>
      </div>

      {/* Interactive Companion Preview (PRD §11) */}
      <Dialog open={simOpen} onOpenChange={setSimOpen}>
        <DialogContent className="max-w-md overflow-hidden p-0">
          <div className="flex items-center justify-between border-b bg-sidebar px-5 py-3.5">
            <DialogHeader className="space-y-0 text-left">
              <DialogTitle className="text-sm font-semibold">
                Live Companion Preview
              </DialogTitle>
              <DialogDescription className="font-mono text-[11px]">
                {job?.title} · {cfg.framework} · {cfg.length}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="p-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={simStage}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                {simStage === "disclosure" && (
                  <div className="space-y-4">
                    <p className="eyebrow">Capture disclosure · PRD §11.3</p>
                    <ul className="space-y-2 rounded-lg border bg-muted/40 p-3.5 text-xs leading-relaxed text-muted-foreground">
                      <li>• System audio: audio from your selected meeting window or tab.</li>
                      <li>• Microphone: your microphone, only if enabled below.</li>
                      <li>• Audio is sent for live transcription while the session is running.</li>
                      <li>• Raw audio is not retained by default.</li>
                    </ul>

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <span className="flex items-center gap-2 text-sm">
                          <MonitorIcon className="size-4 text-primary" aria-hidden="true" />
                          Tab audio
                        </span>
                        <Switch checked={tabAudio} onCheckedChange={setTabAudio} />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <span className="flex items-center gap-2 text-sm">
                          <MicrophoneIcon className="size-4 text-primary" aria-hidden="true" />
                          Microphone (optional)
                        </span>
                        <Switch checked={micAudio} onCheckedChange={setMicAudio} />
                      </div>
                    </div>

                    <Button
                      className="w-full"
                      disabled={!tabAudio && !micAudio}
                      onClick={() => setSimStage("listening")}
                    >
                      Start session
                    </Button>
                  </div>
                )}

                {simStage === "listening" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Status tone="success" pulse>
                        Listening
                      </Status>
                      <span className="font-mono text-xs text-muted-foreground tabular">03:18</span>
                    </div>

                    <div className="space-y-2 rounded-lg border p-3.5">
                      <p className="eyebrow">{cfg.interviewType} question detected</p>
                      <p className="text-sm font-medium">
                        “Walk me through a project relevant to {job?.title}.”
                      </p>
                      <div className="border-l-2 border-primary pl-3 text-xs leading-relaxed text-muted-foreground">
                        <p className="mb-1 font-mono text-[11px] text-primary">{cfg.framework}</p>
                        <p>
                          {profile?.experience[0]
                            ? `${profile.experience[0].role} at ${profile.experience[0].employer}: ${profile.experience[0].summary}`
                            : "No verified experience found. Add a role in your profile."}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t pt-3">
                      <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                        <SpeakerHighIcon className="size-3.5" aria-hidden="true" />
                        Tab: {tabAudio ? "on" : "off"} · Mic: {micAudio ? "on" : "off"}
                      </span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setSimStage("paused")}>
                          <PauseIcon className="size-3.5" aria-hidden="true" />
                          Pause
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setSimStage("ended")}
                        >
                          <StopIcon className="size-3.5" weight="fill" aria-hidden="true" />
                          Stop
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {simStage === "paused" && (
                  <div className="space-y-4">
                    <Status tone="warning">Paused</Status>
                    <p className="text-sm text-muted-foreground">
                      Audio transmission is stopped. Resume explicitly when you are ready to
                      continue.
                    </p>
                    <div className="flex gap-2">
                      <Button className="flex-1" onClick={() => setSimStage("listening")}>
                        <PlayIcon className="size-4" aria-hidden="true" />
                        Resume
                      </Button>
                      <Button variant="destructive" onClick={() => setSimStage("ended")}>
                        Stop session
                      </Button>
                    </div>
                  </div>
                )}

                {simStage === "ended" && (
                  <div className="space-y-4">
                    <Status tone="neutral">Session ended</Status>
                    <p className="text-sm text-muted-foreground">
                      Capture tracks closed. Transcript{" "}
                      {cfg.retainTranscript ? "retained per your setting" : "discarded"}.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => setSimOpen(false)}>
                        Close preview
                      </Button>
                      <Button className="flex-1" onClick={saveSimulatedSession}>
                        Save & review on dashboard
                      </Button>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
