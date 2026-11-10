import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OriginBadge, PageHeader } from "@/components/vren";
import { setState, useAppState } from "@/lib/store";

export const Route = createFileRoute("/app/profile/review")({
  head: () => ({
    meta: [
      { title: "CV review — Vren AI" },
      { name: "description", content: "Review extracted CV fields and save a verified profile." },
      { property: "og:title", content: "CV review — Vren AI" },
      { property: "og:description", content: "Verify what was extracted from your CV." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Review,
});

function Review() {
  const { profile } = useAppState();
  const navigate = useNavigate();
  if (!profile) return null;
  const set = (id: string, key: "role" | "employer" | "dates" | "summary", v: string) =>
    setState((s) => ({ ...s, profile: s.profile && { ...s.profile, experience: s.profile.experience.map((e) => (e.id === id ? { ...e, [key]: v } : e)) } }));

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="CV review" title="Check what we extracted" description="Edit or remove anything inaccurate. Nothing becomes eligible for suggestions until you save." />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel bg-muted p-5">
          <p className="eyebrow mb-3">Source · {profile.documents[0]?.name ?? "No document"}</p>
          <div className="space-y-4 font-mono text-xs leading-relaxed text-muted-foreground">
            <p className="text-sm font-semibold text-foreground">{profile.name.toUpperCase()}</p>
            <p>{profile.summary}</p>
            {profile.experience.map((e) => (
              <div key={e.id}>
                <p className="text-foreground">{e.role} — {e.employer}</p>
                <p>{e.dates}</p>
                <p>{e.summary}</p>
              </div>
            ))}
            <p>SKILLS: {profile.skills.filter((s) => s.origin !== "missing").map((s) => s.name).join(", ")}</p>
          </div>
        </section>
        <section className="space-y-4">
          {profile.experience.map((e) => (
            <div key={e.id} className="panel space-y-2 p-4">
              <div className="flex justify-between"><OriginBadge origin={e.origin} confidence={e.confidence} /></div>
              <Input aria-label="Role" value={e.role} onChange={(ev) => set(e.id, "role", ev.target.value)} />
              <Input aria-label="Employer" value={e.employer} onChange={(ev) => set(e.id, "employer", ev.target.value)} />
              <Input aria-label="Dates" className="font-mono text-xs" value={e.dates} onChange={(ev) => set(e.id, "dates", ev.target.value)} />
              <Input aria-label="Evidence" value={e.summary} onChange={(ev) => set(e.id, "summary", ev.target.value)} />
            </div>
          ))}
          {profile.skills.some((s) => s.origin === "missing") && (
            <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
              Some skills mentioned in jobs have no evidence in your CV. Add evidence in your profile or leave them out.
            </p>
          )}
          <Button
            className="w-full"
            onClick={() => {
              setState((s) => ({
                ...s,
                profile: s.profile && {
                  ...s.profile,
                  experience: s.profile.experience.map((e) => ({ ...e, origin: "verified" })),
                  education: s.profile.education.map((e) => ({ ...e, origin: "verified" })),
                  skills: s.profile.skills.map((x) => (x.origin === "extracted" ? { ...x, origin: "verified" } : x)),
                },
              }));
              toast.success("Profile verified.");
              navigate({ to: "/app/profile" });
            }}
          >
            Save verified profile
          </Button>
        </section>
      </div>
    </div>
  );
}
