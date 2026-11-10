import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCircleIcon,
  FileTextIcon,
  GraduationCapIcon,
  PlusIcon,
  SpinnerGapIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DetailSkeleton } from "@/components/loading";
import { PageTransition } from "@/components/motion";
import { ConfidenceBar, EmptyState, OriginBadge, PageHeader, Status } from "@/components/vren";
import {
  addDocument,
  deleteDocument,
  LANGUAGES,
  uid,
  unverifiedCount,
  updateProfile,
  useAppState,
  type Profile,
} from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/profile/")({
  head: () => ({
    meta: [
      { title: "Candidate profile | Vren AI" },
      { name: "description", content: "Edit your experience, skills, education and documents." },
      { property: "og:title", content: "Candidate profile | Vren AI" },
      { property: "og:description", content: "Your structured candidate context." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
  pendingComponent: DetailSkeleton,
});

const tabs = ["Overview", "Experience", "Skills", "Education", "Documents"] as const;
const MAX_BYTES = 5 * 1024 * 1024;

function patch(fn: (p: Profile) => Profile) {
  // Read latest profile via updateProfile inside handlers
  return fn;
}

function ProfilePage() {
  const { profile } = useAppState();
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [newSkill, setNewSkill] = useState("");
  const [docError, setDocError] = useState<string | null>(null);
  if (!profile) return null;

  const unverified = unverifiedCount(profile);
  const save = (fn: (p: Profile) => Partial<Profile>) => updateProfile(fn(profile));

  const handleUpload = (file: File | null) => {
    setDocError(null);
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "docx") {
      setDocError("Unsupported file type. Upload a PDF or DOCX document.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setDocError("File exceeds the 5 MB / 10-page limit.");
      return;
    }
    addDocument({ name: file.name, sizeKb: Math.max(1, Math.round(file.size / 1024)) });
    toast.success("CV queued for extraction. Fields will appear once processed.");
  };

  return (
    <PageTransition className="space-y-8">
      <PageHeader
        eyebrow="Candidate profile"
        title={profile.name}
        description="Only information you verify is used with confidence in live suggestions. Empty fields are never inferred."
        actions={
          <Button variant={unverified > 0 ? "default" : "outline"} asChild>
            <Link to="/app/profile/review">
              Open CV review
              {unverified > 0 && (
                <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.2 font-mono text-[11px]">
                  {unverified}
                </span>
              )}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-8 md:grid-cols-[190px_1fr]">
        <nav className="scrollbar-none flex gap-1 overflow-x-auto md:flex-col" aria-label="Profile sections">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center justify-between whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors",
                tab === t
                  ? "border bg-card font-medium text-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span>{t}</span>
              {t === "Experience" && (
                <span className="ml-2 font-mono text-[11px] text-muted-foreground tabular">
                  {profile.experience.length}
                </span>
              )}
              {t === "Skills" && (
                <span className="ml-2 font-mono text-[11px] text-muted-foreground tabular">
                  {profile.skills.length}
                </span>
              )}
              {t === "Documents" && (
                <span className="ml-2 font-mono text-[11px] text-muted-foreground tabular">
                  {profile.documents.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="space-y-4">
          {tab === "Overview" && (
            <div className="panel space-y-5 p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    value={profile.name}
                    onChange={(e) => updateProfile({ name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="headline">Headline</Label>
                  <Input
                    id="headline"
                    placeholder="e.g. Senior Product Designer"
                    value={profile.headline}
                    onChange={(e) => updateProfile({ headline: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="summary">Professional summary</Label>
                <Textarea
                  id="summary"
                  rows={4}
                  placeholder="Summarise the domains, products, and outcomes you actually led."
                  value={profile.summary}
                  onChange={(e) => updateProfile({ summary: e.target.value })}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="focus">Role focus</Label>
                  <Input
                    id="focus"
                    value={profile.roleFocus}
                    onChange={(e) => updateProfile({ roleFocus: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    placeholder="City, Country"
                    value={profile.location}
                    onChange={(e) => updateProfile({ location: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lang">Preferred language</Label>
                  <select
                    id="lang"
                    value={profile.language}
                    onChange={(e) => updateProfile({ language: e.target.value })}
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

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 font-mono text-xs text-muted-foreground">
                <span>Changes save automatically</span>
                <span>
                  {profile.verifiedAt
                    ? `Last verified ${format(new Date(profile.verifiedAt), "d MMM yyyy, HH:mm")}`
                    : "Not yet verified in CV review"}
                </span>
              </div>
            </div>
          )}

          {tab === "Experience" && (
            <>
              {profile.experience.length === 0 && (
                <EmptyState
                  title="No experience added yet."
                  description="Upload a CV or add roles manually so live suggestions can cite real outcomes."
                />
              )}
              {profile.experience.map((e) => (
                <div key={e.id} className="panel space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid flex-1 gap-2.5 sm:grid-cols-3">
                      <Input
                        aria-label="Role"
                        placeholder="Role title"
                        value={e.role}
                        onChange={(ev) =>
                          save((p) => ({
                            experience: p.experience.map((x) =>
                              x.id === e.id ? { ...x, role: ev.target.value, origin: "verified" } : x,
                            ),
                          }))
                        }
                      />
                      <Input
                        aria-label="Employer"
                        placeholder="Employer"
                        value={e.employer}
                        onChange={(ev) =>
                          save((p) => ({
                            experience: p.experience.map((x) =>
                              x.id === e.id ? { ...x, employer: ev.target.value, origin: "verified" } : x,
                            ),
                          }))
                        }
                      />
                      <Input
                        aria-label="Dates"
                        placeholder="e.g. 2022 – Present"
                        className="font-mono text-xs"
                        value={e.dates}
                        onChange={(ev) =>
                          save((p) => ({
                            experience: p.experience.map((x) =>
                              x.id === e.id ? { ...x, dates: ev.target.value, origin: "verified" } : x,
                            ),
                          }))
                        }
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${e.role || "role"}`}
                      onClick={() =>
                        save((p) => ({
                          experience: p.experience.filter((x) => x.id !== e.id),
                        }))
                      }
                    >
                      <TrashIcon className="size-4" aria-hidden="true" />
                    </Button>
                  </div>

                  <Textarea
                    aria-label="Evidence"
                    rows={2}
                    placeholder="Concrete outcomes, metrics, or scope you personally delivered."
                    value={e.summary}
                    onChange={(ev) =>
                      save((p) => ({
                        experience: p.experience.map((x) =>
                          x.id === e.id
                            ? {
                                ...x,
                                summary: ev.target.value,
                                origin: ev.target.value.trim() ? "verified" : "missing",
                              }
                            : x,
                        ),
                      }))
                    }
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <OriginBadge origin={e.origin} confidence={e.confidence} />
                      {e.source && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {e.source}
                        </span>
                      )}
                      {e.confidence !== undefined && e.origin !== "verified" && (
                        <ConfidenceBar value={e.confidence} />
                      )}
                    </div>
                    {e.origin === "extracted" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          save((p) => ({
                            experience: p.experience.map((x) =>
                              x.id === e.id ? { ...x, origin: "verified" } : x,
                            ),
                          }))
                        }
                      >
                        <CheckCircleIcon className="size-3.5 text-success" aria-hidden="true" />
                        Verify
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() =>
                  save((p) => ({
                    experience: [
                      ...p.experience,
                      { id: uid(), role: "", employer: "", dates: "", summary: "", origin: "verified" },
                    ],
                  }))
                }
              >
                <PlusIcon className="size-4" aria-hidden="true" />
                Add role
              </Button>
            </>
          )}

          {tab === "Skills" && (
            <div className="panel space-y-5 p-6">
              <div>
                <p className="text-sm font-medium text-foreground">Verified & extracted skills</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Skills marked Missing were referenced in target jobs but not found in your CV.
                </p>
              </div>
              {profile.skills.length === 0 ? (
                <EmptyState title="No skills added yet." />
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {profile.skills.map((s) => (
                    <li
                      key={s.name}
                      className="flex items-center gap-2 rounded-lg border bg-background py-1.5 pr-1.5 pl-3 text-sm"
                    >
                      <span>{s.name}</span>
                      <OriginBadge origin={s.origin} />
                      {s.origin === "extracted" && (
                        <button
                          type="button"
                          aria-label={`Verify ${s.name}`}
                          className="rounded p-1 text-primary hover:bg-primary-soft"
                          onClick={() =>
                            save((p) => ({
                              skills: p.skills.map((x) =>
                                x.name === s.name ? { ...x, origin: "verified" } : x,
                              ),
                            }))
                          }
                        >
                          <CheckCircleIcon className="size-3.5" aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${s.name}`}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          save((p) => ({
                            skills: p.skills.filter((x) => x.name !== s.name),
                          }))
                        }
                      >
                        <TrashIcon className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <form
                className="flex gap-2 border-t pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newSkill.trim();
                  if (!name) return;
                  if (profile.skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
                    toast("That skill is already listed.");
                    return;
                  }
                  save((p) => ({ skills: [...p.skills, { name, origin: "verified" }] }));
                  setNewSkill("");
                }}
              >
                <Input
                  placeholder="Add a skill you can speak to in an interview"
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                />
                <Button type="submit" variant="outline">
                  Add skill
                </Button>
              </form>
            </div>
          )}

          {tab === "Education" && (
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Education</h2>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      save((p) => ({
                        education: [
                          ...p.education,
                          { id: uid(), school: "", degree: "", dates: "", origin: "verified" },
                        ],
                      }))
                    }
                  >
                    <PlusIcon className="size-3.5" aria-hidden="true" />
                    Add education
                  </Button>
                </div>
                {profile.education.length === 0 && (
                  <EmptyState
                    icon={<GraduationCapIcon className="size-5" aria-hidden="true" />}
                    title="No education added."
                  />
                )}
                {profile.education.map((e) => (
                  <div key={e.id} className="panel space-y-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid flex-1 gap-2 sm:grid-cols-3">
                        <Input
                          aria-label="Degree"
                          placeholder="Degree or credential"
                          value={e.degree}
                          onChange={(ev) =>
                            save((p) => ({
                              education: p.education.map((x) =>
                                x.id === e.id ? { ...x, degree: ev.target.value, origin: "verified" } : x,
                              ),
                            }))
                          }
                        />
                        <Input
                          aria-label="Institution"
                          placeholder="School"
                          value={e.school}
                          onChange={(ev) =>
                            save((p) => ({
                              education: p.education.map((x) =>
                                x.id === e.id ? { ...x, school: ev.target.value, origin: "verified" } : x,
                              ),
                            }))
                          }
                        />
                        <Input
                          aria-label="Dates"
                          placeholder="2014 – 2018"
                          className="font-mono text-xs"
                          value={e.dates}
                          onChange={(ev) =>
                            save((p) => ({
                              education: p.education.map((x) =>
                                x.id === e.id ? { ...x, dates: ev.target.value, origin: "verified" } : x,
                              ),
                            }))
                          }
                        />
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete education"
                        onClick={() =>
                          save((p) => ({
                            education: p.education.filter((x) => x.id !== e.id),
                          }))
                        }
                      >
                        <TrashIcon className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                    <OriginBadge origin={e.origin} confidence={e.confidence} />
                  </div>
                ))}
              </div>

              <div className="space-y-3 border-t pt-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Projects & Certifications</h2>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      save((p) => ({
                        projects: [
                          ...p.projects,
                          { id: uid(), name: "", summary: "", origin: "verified" },
                        ],
                      }))
                    }
                  >
                    <PlusIcon className="size-3.5" aria-hidden="true" />
                    Add project
                  </Button>
                </div>
                {profile.projects.map((pr) => (
                  <div key={pr.id} className="panel space-y-2.5 p-5">
                    <div className="flex items-center justify-between gap-2">
                      <Input
                        aria-label="Project name"
                        placeholder="Project title"
                        value={pr.name}
                        onChange={(ev) =>
                          save((p) => ({
                            projects: p.projects.map((x) =>
                              x.id === pr.id ? { ...x, name: ev.target.value, origin: "verified" } : x,
                            ),
                          }))
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete project"
                        onClick={() =>
                          save((p) => ({ projects: p.projects.filter((x) => x.id !== pr.id) }))
                        }
                      >
                        <TrashIcon className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                    <Textarea
                      aria-label="Project summary"
                      rows={2}
                      placeholder="What you built and its outcome."
                      value={pr.summary}
                      onChange={(ev) =>
                        save((p) => ({
                          projects: p.projects.map((x) =>
                            x.id === pr.id ? { ...x, summary: ev.target.value, origin: "verified" } : x,
                          ),
                        }))
                      }
                    />
                    <OriginBadge origin={pr.origin} />
                  </div>
                ))}
                {profile.certifications.map((cert) => (
                  <div key={cert.id} className="panel flex items-center justify-between gap-3 p-4">
                    <div className="text-sm">
                      <p className="font-medium">{cert.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {cert.issuer} · <span className="font-mono">{cert.year}</span>
                      </p>
                    </div>
                    <OriginBadge origin={cert.origin} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "Documents" && (
            <div className="space-y-4">
              <label className="panel flex cursor-pointer flex-col items-center gap-2 border-dashed p-7 text-center transition-colors hover:bg-muted/50">
                <UploadSimpleIcon className="size-5 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium">
                  Upload a CV (PDF or DOCX, up to 5 MB and 10 pages)
                </span>
                <span className="text-xs text-muted-foreground">
                  Stored privately. You can replace or delete documents anytime.
                </span>
                <input
                  type="file"
                  accept=".pdf,.docx"
                  className="sr-only"
                  onChange={(e) => {
                    handleUpload(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
              </label>

              {docError && (
                <p
                  role="alert"
                  className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive"
                >
                  <WarningCircleIcon className="size-4 shrink-0" aria-hidden="true" />
                  {docError}
                </p>
              )}

              {profile.documents.length === 0 ? (
                <EmptyState title="No documents uploaded yet." />
              ) : (
                profile.documents.map((d) => (
                  <div key={d.id} className="panel flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3 text-sm">
                      <FileTextIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-foreground">{d.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {format(new Date(d.uploadedAt), "d MMM yyyy, HH:mm")}
                          {d.sizeKb ? ` · ${d.sizeKb} KB` : ""}
                          {d.pages ? ` · ${d.pages} pages` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {d.status === "processing" ? (
                        <Status tone="brand">
                          <SpinnerGapIcon className="size-3 animate-spin" aria-hidden="true" />
                          Extracting…
                        </Status>
                      ) : d.status === "failed" ? (
                        <Status tone="error">Extraction failed</Status>
                      ) : (
                        <Status tone="success">Processed</Status>
                      )}

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost">
                            <TrashIcon className="size-4" aria-hidden="true" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {d.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              The original document is permanently removed from storage. Fields you
                              already verified in your profile stay intact, and historical session
                              records are unaffected.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => {
                                deleteDocument(d.id);
                                toast("Document deleted.");
                              }}
                            >
                              Delete document
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
