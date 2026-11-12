import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { UploadSimpleIcon } from "@phosphor-icons/react/UploadSimple";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnimatePresence, motion, EASE } from "@/components/motion";
import { Logo } from "@/components/vren";
import { completeOnboarding, getState, LANGUAGES } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  beforeLoad: () => {
    if (!getState().user) throw redirect({ to: "/auth", search: { mode: "signin" } });
  },
  head: () => ({
    meta: [
      { title: "Get started | Vren AI" },
      { name: "description", content: "Set up your Vren AI profile in two short steps." },
      { property: "og:title", content: "Get started | Vren AI" },
      { property: "og:description", content: "Profile basics and CV upload." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Onboarding,
});

const steps = ["Profile basics", "Add a CV"];
const MAX_BYTES = 5 * 1024 * 1024;

function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<string>(LANGUAGES[0]);
  const [roleFocus, setRoleFocus] = useState("");
  const [cv, setCv] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const acceptFile = (file: File | null) => {
    setFileError(null);
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "docx") {
      setFileError("Unsupported format. Upload a PDF or DOCX file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setFileError("File exceeds the 5 MB limit. Compress or trim to 10 pages.");
      return;
    }
    setCv(file);
  };

  const finish = async (withCvFile: File | null) => {
    setSubmitting(true);
    try {
      await completeOnboarding(
        name.trim() || "Candidate",
        language,
        roleFocus.trim(),
        !!withCvFile,
        withCvFile,
      );
      navigate({ to: withCvFile ? "/app/profile/review" : "/app" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not complete onboarding.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background pb-[env(safe-area-inset-bottom)]">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <span className="font-mono text-xs text-muted-foreground tabular">
            Step {step + 1} of {steps.length}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <ol className="mb-10 grid grid-cols-2 gap-3" aria-label="Onboarding progress">
          {steps.map((s, i) => (
            <li key={s} className="space-y-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    i <= step ? "w-full bg-primary" : "w-0 bg-primary",
                  )}
                />
              </div>
              <p
                className={cn(
                  "flex items-center gap-1.5 text-xs",
                  i === step
                    ? "font-medium text-foreground"
                    : i < step
                      ? "text-success"
                      : "text-muted-foreground",
                )}
              >
                {i < step && <CheckIcon className="size-3.5" weight="bold" aria-hidden="true" />}
                <span>{s}</span>
              </p>
            </li>
          ))}
        </ol>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="panel p-7 sm:p-9"
          >
            {step === 0 && (
              <section className="space-y-6">
                <div>
                  <p className="eyebrow mb-2">Step 01 · Candidate identity</p>
                  <h1 className="font-display text-3xl tracking-tight">Tell us a little about you</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Your profile stays reusable across every job description you add.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="name">Full name</Label>
                    <Input
                      id="name"
                      placeholder="e.g. Ada Obi"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lang">Response language</Label>
                    <select
                      id="lang"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-card px-3 text-base md:h-9 md:text-sm"
                    >
                      {LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      English is the primary evaluated launch language.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="focus">Role focus (optional)</Label>
                    <Input
                      id="focus"
                      placeholder="e.g. Product design, Backend engineering"
                      value={roleFocus}
                      onChange={(e) => setRoleFocus(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex justify-end border-t pt-5">
                  <Button onClick={() => setStep(1)} disabled={!name.trim()}>
                    Continue
                    <ArrowRightIcon className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </section>
            )}

            {step === 1 && (
              <section className="space-y-6">
                <div>
                  <p className="eyebrow mb-2">Step 02 · Structured context</p>
                  <h1 className="font-display text-3xl tracking-tight">Add your CV</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    PDF or DOCX, up to 5 MB and 10 pages. You’ll review every extracted field before
                    it becomes eligible for live suggestions.
                  </p>
                </div>

                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    acceptFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center transition-colors",
                    dragging
                      ? "border-primary bg-primary-soft/40"
                      : "border-border-strong bg-background hover:bg-muted/60",
                  )}
                >
                  <div className="grid size-11 place-items-center rounded-xl border bg-card text-primary shadow-xs">
                    {cv ? (
                      <FileTextIcon className="size-5" aria-hidden="true" />
                    ) : (
                      <UploadSimpleIcon className="size-5" aria-hidden="true" />
                    )}
                  </div>
                  {cv ? (
                    <>
                      <span className="text-sm font-medium text-foreground">{cv.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {Math.max(1, Math.round(cv.size / 1024))} KB · Ready for extraction
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-foreground">
                        Drop your CV here, or click to choose a file
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Stored in private storage. Only you can access or delete it.
                      </span>
                    </>
                  )}
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    className="sr-only"
                    onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
                  />
                </label>

                {fileError && (
                  <p
                    role="alert"
                    className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive"
                  >
                    <WarningCircleIcon className="size-4 shrink-0" aria-hidden="true" />
                    {fileError}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                  <Button variant="ghost" onClick={() => setStep(0)}>
                    <ArrowLeftIcon className="size-4" aria-hidden="true" />
                    Back
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={submitting}
                      onClick={() => {
                        setCv(null);
                        void finish(null);
                      }}
                    >
                      Continue without a CV
                    </Button>
                    <Button disabled={!cv || submitting} onClick={() => void finish(cv)}>
                      {submitting ? "Setting up..." : "Finish setup"}
                    </Button>
                  </div>
                </div>
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
