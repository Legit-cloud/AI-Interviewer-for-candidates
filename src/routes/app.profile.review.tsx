import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircleIcon, FileTextIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DetailSkeleton } from "@/components/loading";
import { PageTransition } from "@/components/motion";
import { ConfidenceBar, EmptyState, OriginBadge, PageHeader } from "@/components/vren";
import { saveVerifiedProfile, updateProfile, useAppState } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/profile/review")({
  head: () => ({
    meta: [
      { title: "CV review | Vren AI" },
      { name: "description", content: "Review extracted CV fields and save a verified profile." },
      { property: "og:title", content: "CV review | Vren AI" },
      { property: "og:description", content: "Verify what was extracted from your CV." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Review,
  pendingComponent: DetailSkeleton,
});

function Review() {
  const { profile } = useAppState();
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState<string | null>(null);
  if (!profile) return null;

  const setExp = (id: string, key: "role" | "employer" | "dates" | "summary", v: string) =>
    updateProfile({
      experience: profile.experience.map((e) =>
        e.id === id ? { ...e, [key]: v, origin: key === "summary" && !v.trim() ? "missing" : e.origin } : e,
      ),
    });

  const removeExp = (id: string) =>
    updateProfile({ experience: profile.experience.filter((e) => e.id !== id) });

  const hasMissing =
    profile.skills.some((s) => s.origin === "missing") ||
    profile.experience.some((e) => e.origin === "missing" || !e.summary.trim());

  return (
    <PageTransition className="space-y-8">
      <PageHeader
        eyebrow="CV review"
        title="Check what we extracted"
        description="Edit or remove anything inaccurate. Only verified fields are used with confidence in live suggestions."
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/profile">Back to profile</Link>
          </Button>
        }
      />

      {profile.experience.length === 0 && profile.education.length === 0 ? (
        <EmptyState
          icon={<FileTextIcon className="size-5" aria-hidden="true" />}
          title="Nothing extracted yet"
          description="Upload a CV in your profile or add experience manually to verify it here."
        >
          <Button variant="outline" asChild>
            <Link to="/app/profile">Go to profile</Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          {/* Left Pane: Source Document Preview */}
          <section className="panel h-fit bg-muted/50 p-6 lg:sticky lg:top-6">
            <div className="mb-4 flex items-center justify-between border-b pb-3">
              <p className="eyebrow">
                Source · {profile.documents[0]?.name ?? "Manual profile"}
              </p>
              {profile.documents[0]?.pages && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {profile.documents[0].pages} pages
                </span>
              )}
            </div>
            <div className="space-y-4 font-mono text-xs leading-relaxed text-muted-foreground">
              <div>
                <p className="text-sm font-semibold text-foreground">{profile.name.toUpperCase()}</p>
                {profile.headline && <p className="text-foreground/80">{profile.headline}</p>}
              </div>
              {profile.summary && <p>{profile.summary}</p>}
              <div className="space-y-3 border-t pt-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Experience
                </p>
                {profile.experience.map((e) => (
                  <div
                    key={e.id}
                    className={cn(
                      "rounded-md p-2 transition-colors",
                      activeId === e.id && "bg-primary-soft/70 text-foreground ring-1 ring-primary/30",
                    )}
                  >
                    <p className="font-medium text-foreground">
                      {e.role || "Untitled role"} at {e.employer || "Employer"}
                    </p>
                    <p>{e.dates || "Dates missing"}</p>
                    <p className="mt-0.5">{e.summary || "[No outcome text extracted]"}</p>
                  </div>
                ))}
              </div>
              {profile.education.length > 0 && (
                <div className="space-y-1.5 border-t pt-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Education
                  </p>
                  {profile.education.map((ed) => (
                    <p key={ed.id}>
                      {ed.degree} · {ed.school} ({ed.dates})
                    </p>
                  ))}
                </div>
              )}
              <div className="border-t pt-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Skills</p>
                <p className="mt-1">
                  {profile.skills
                    .filter((s) => s.origin !== "missing")
                    .map((s) => s.name)
                    .join(", ") || "None"}
                </p>
              </div>
            </div>
          </section>

          {/* Right Pane: Structured Review */}
          <section className="space-y-4">
            <div className="panel space-y-2 p-5">
              <Label htmlFor="rev-summary">Professional summary</Label>
              <Textarea
                id="rev-summary"
                rows={3}
                value={profile.summary}
                onChange={(e) => updateProfile({ summary: e.target.value })}
              />
            </div>

            {profile.experience.map((e) => (
              <div
                key={e.id}
                onFocus={() => setActiveId(e.id)}
                className="panel space-y-3 p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <OriginBadge origin={e.origin} confidence={e.confidence} />
                    {e.confidence !== undefined && <ConfidenceBar value={e.confidence} />}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove entry"
                    onClick={() => removeExp(e.id)}
                  >
                    <TrashIcon className="size-4" aria-hidden="true" />
                  </Button>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Input
                    aria-label="Role"
                    placeholder="Role"
                    value={e.role}
                    onChange={(ev) => setExp(e.id, "role", ev.target.value)}
                  />
                  <Input
                    aria-label="Employer"
                    placeholder="Employer"
                    value={e.employer}
                    onChange={(ev) => setExp(e.id, "employer", ev.target.value)}
                  />
                </div>
                <Input
                  aria-label="Dates"
                  placeholder="Dates"
                  className="font-mono text-xs"
                  value={e.dates}
                  onChange={(ev) => setExp(e.id, "dates", ev.target.value)}
                />
                <Textarea
                  aria-label="Evidence"
                  rows={2}
                  placeholder="Describe what you delivered (leave blank if none; Vren won't invent outcomes)."
                  value={e.summary}
                  onChange={(ev) => setExp(e.id, "summary", ev.target.value)}
                />
              </div>
            ))}

            {hasMissing && (
              <div className="flex items-start gap-2.5 rounded-xl border border-warning/35 bg-warning/8 p-4 text-sm text-warning">
                <WarningCircleIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden="true" />
                <p>
                  Some roles or skills have missing evidence. Add real outcomes above or leave them
                  unclaimed; Vren AI will never fabricate them during an interview.
                </p>
              </div>
            )}

            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                saveVerifiedProfile(profile);
                toast.success("Profile verified and ready for preparation.");
                navigate({ to: "/app/profile" });
              }}
            >
              <CheckCircleIcon className="size-4" aria-hidden="true" />
              Save verified profile
            </Button>
          </section>
        </div>
      )}
    </PageTransition>
  );
}
