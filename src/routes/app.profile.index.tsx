import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Upload, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState, OriginBadge, PageHeader } from "@/components/vren";
import { sampleProfile, setState, uid, useAppState, type Profile } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/profile/")({
  head: () => ({
    meta: [
      { title: "Candidate profile — Vren AI" },
      { name: "description", content: "Edit your experience, skills, education and documents." },
      { property: "og:title", content: "Candidate profile — Vren AI" },
      { property: "og:description", content: "Your structured candidate context." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

const tabs = ["Overview", "Experience", "Skills", "Education", "Documents"] as const;

function update(fn: (p: Profile) => Profile) {
  setState((s) => (s.profile ? { ...s, profile: fn(s.profile) } : s));
}

function ProfilePage() {
  const { profile } = useAppState();
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [newSkill, setNewSkill] = useState("");
  if (!profile) return null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Candidate profile"
        title={profile.name}
        description="Only information you verify is used with confidence in live suggestions. Empty fields are never inferred."
        actions={<Button variant="outline" asChild><Link to="/app/profile/review">Open CV review</Link></Button>}
      />
      <div className="grid gap-8 md:grid-cols-[160px_1fr]">
        <nav className="flex gap-1 md:flex-col" aria-label="Profile sections">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("rounded-md px-3 py-2 text-left text-sm", tab === t ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
            >
              {t}
            </button>
          ))}
        </nav>

        <div className="space-y-4">
          {tab === "Overview" && (
            <div className="panel space-y-4 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="headline">Headline</Label>
                <Input id="headline" value={profile.headline} onChange={(e) => update((p) => ({ ...p, headline: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="summary">Summary</Label>
                <Textarea id="summary" rows={4} value={profile.summary} onChange={(e) => update((p) => ({ ...p, summary: e.target.value }))} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="focus">Role focus</Label>
                  <Input id="focus" value={profile.roleFocus} onChange={(e) => update((p) => ({ ...p, roleFocus: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Language</Label>
                  <Input value={profile.language} disabled />
                </div>
              </div>
              <p className="font-mono text-xs text-muted-foreground">Saved automatically</p>
            </div>
          )}

          {tab === "Experience" && (
            <>
              {profile.experience.length === 0 && <EmptyState title="No experience added yet." />}
              {profile.experience.map((e) => (
                <div key={e.id} className="panel space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid flex-1 gap-2 md:grid-cols-3">
                      <Input aria-label="Role" value={e.role} onChange={(ev) => update((p) => ({ ...p, experience: p.experience.map((x) => (x.id === e.id ? { ...x, role: ev.target.value, origin: "verified" } : x)) }))} />
                      <Input aria-label="Employer" value={e.employer} onChange={(ev) => update((p) => ({ ...p, experience: p.experience.map((x) => (x.id === e.id ? { ...x, employer: ev.target.value, origin: "verified" } : x)) }))} />
                      <Input aria-label="Dates" className="font-mono text-xs" value={e.dates} onChange={(ev) => update((p) => ({ ...p, experience: p.experience.map((x) => (x.id === e.id ? { ...x, dates: ev.target.value, origin: "verified" } : x)) }))} />
                    </div>
                    <Button size="icon" variant="ghost" aria-label="Delete role" onClick={() => update((p) => ({ ...p, experience: p.experience.filter((x) => x.id !== e.id) }))}>
                      <Trash2 />
                    </Button>
                  </div>
                  <Textarea aria-label="Evidence" rows={2} value={e.summary} onChange={(ev) => update((p) => ({ ...p, experience: p.experience.map((x) => (x.id === e.id ? { ...x, summary: ev.target.value, origin: "verified" } : x)) }))} />
                  <OriginBadge origin={e.origin} confidence={e.confidence} />
                </div>
              ))}
              <Button variant="outline" onClick={() => update((p) => ({ ...p, experience: [...p.experience, { id: uid(), role: "", employer: "", dates: "", summary: "", origin: "verified" }] }))}>
                <Plus /> Add role
              </Button>
            </>
          )}

          {tab === "Skills" && (
            <div className="panel space-y-4 p-5">
              <ul className="flex flex-wrap gap-2">
                {profile.skills.map((s) => (
                  <li key={s.name} className="flex items-center gap-2 rounded-md border bg-background py-1 pr-1 pl-3 text-sm">
                    {s.name}
                    <OriginBadge origin={s.origin} />
                    <button aria-label={`Remove ${s.name}`} className="p-1 text-muted-foreground hover:text-destructive" onClick={() => update((p) => ({ ...p, skills: p.skills.filter((x) => x.name !== s.name) }))}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newSkill.trim()) return;
                  update((p) => ({ ...p, skills: [...p.skills, { name: newSkill.trim(), origin: "verified" }] }));
                  setNewSkill("");
                }}
              >
                <Input placeholder="Add a skill" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} />
                <Button type="submit" variant="outline">Add</Button>
              </form>
            </div>
          )}

          {tab === "Education" && (
            <>
              {profile.education.length === 0 && <EmptyState title="No education added." />}
              {profile.education.map((e) => (
                <div key={e.id} className="panel flex items-center justify-between p-5">
                  <div>
                    <p className="font-medium">{e.degree}</p>
                    <p className="text-sm text-muted-foreground">{e.school} · <span className="font-mono text-xs">{e.dates}</span></p>
                  </div>
                  <OriginBadge origin={e.origin} />
                </div>
              ))}
            </>
          )}

          {tab === "Documents" && (
            <>
              <label className="panel flex cursor-pointer items-center gap-3 border-dashed p-5 text-sm hover:bg-muted">
                <Upload className="size-4 text-primary" />
                <span>Upload a new CV — PDF or DOCX, up to 5 MB, 10 pages</span>
                <input
                  type="file"
                  accept=".pdf,.docx"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const extracted = sampleProfile(profile.name);
                    update((p) => ({
                      ...p,
                      experience: p.experience.length ? p.experience : extracted.experience,
                      skills: p.skills.length ? p.skills : extracted.skills,
                      education: p.education.length ? p.education : extracted.education,
                      documents: [...p.documents, { id: uid(), name: f.name, uploadedAt: new Date().toISOString(), status: "processed" }],
                    }));
                    toast.success("CV processed. Review the extracted fields.");
                  }}
                />
              </label>
              {profile.documents.map((d) => (
                <div key={d.id} className="panel flex items-center justify-between p-4">
                  <span className="flex items-center gap-3 text-sm">
                    <FileText className="size-4 text-muted-foreground" /> {d.name}
                  </span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost"><Trash2 /> Delete</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {d.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The original file is permanently removed. Fields you've already reviewed in your profile stay, and past sessions are unaffected.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => update((p) => ({ ...p, documents: p.documents.filter((x) => x.id !== d.id) }))}>
                          Delete document
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
