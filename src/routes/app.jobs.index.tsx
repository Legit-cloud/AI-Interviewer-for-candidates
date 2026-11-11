import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BriefcaseIcon } from "@phosphor-icons/react/Briefcase";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { UploadSimpleIcon } from "@phosphor-icons/react/UploadSimple";
import { format } from "date-fns";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ListSkeleton } from "@/components/loading";
import { PageTransition } from "@/components/motion";
import { EmptyState, PageHeader, Status } from "@/components/vren";
import { addJobAsync, extractJob, jobCompleteness, matchJob, useAppState } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/jobs/")({
  head: () => ({
    meta: [
      { title: "Jobs | Vren AI" },
      { name: "description", content: "Manage the job descriptions you're preparing for." },
      { property: "og:title", content: "Jobs | Vren AI" },
      { property: "og:description", content: "Active and archived jobs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Jobs,
  pendingComponent: () => <ListSkeleton rows={4} />,
});

function Jobs() {
  const { jobs, profile } = useAppState();
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const [sourceMode, setSourceMode] = useState<"paste" | "upload">("paste");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [seniority, setSeniority] = useState("Senior");
  const [desc, setDesc] = useState("");
  const [uploadedName, setUploadedName] = useState<string | null>(null);

  const list = jobs
    .filter((j) => j.archived === showArchived)
    .filter(
      (j) =>
        !query.trim() ||
        `${j.title} ${j.company}`.toLowerCase().includes(query.trim().toLowerCase()),
    );

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setUploadedName(file.name);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
    if (file.type.startsWith("text/") || /\.(txt|md)$/i.test(file.name)) {
      const text = await file.text();
      setDesc(text.slice(0, 6000));
    } else {
      setDesc(
        `Extracted from ${file.name}: Lead product design across merchant checkout and design systems. Collaborate closely with engineering and PMs on user research, prototyping, and stakeholder alignment.`,
      );
    }
  };

  const create = async () => {
    const parsed = extractJob(desc);
    const id = await addJobAsync({
      title: title.trim(),
      company: company.trim() || "Unspecified",
      seniority,
      source: sourceMode,
      description: desc.trim(),
      ...parsed,
    });
    setOpen(false);
    setTitle("");
    setCompany("");
    setDesc("");
    setUploadedName(null);
    navigate({ to: "/app/jobs/$jobId", params: { jobId: id } });
  };

  return (
    <PageTransition className="space-y-8">
      <PageHeader
        eyebrow="Jobs"
        title="Job descriptions"
        description="Each job is saved independently and compared against your verified profile."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <PlusIcon className="size-4" aria-hidden="true" />
                Create job
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Add a job description</DialogTitle>
                <DialogDescription>
                  Paste text or upload a supported file. You can refine extracted requirements
                  after saving.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex gap-1.5 rounded-lg bg-muted p-1">
                  {(
                    [
                      ["paste", "Paste text"],
                      ["upload", "Upload file"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSourceMode(m)}
                      className={cn(
                        "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
                        sourceMode === m ? "bg-card text-foreground shadow-xs" : "text-muted-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="t">Role title</Label>
                    <Input
                      id="t"
                      placeholder="e.g. Lead Product Designer"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sen">Seniority</Label>
                    <select
                      id="sen"
                      value={seniority}
                      onChange={(e) => setSeniority(e.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-card px-2.5 text-base md:h-9 md:text-sm"
                    >
                      {["Junior", "Mid", "Senior", "Staff", "Lead", "Manager"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="c">Company</Label>
                  <Input
                    id="c"
                    placeholder="e.g. Flutterwave"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </div>

                {sourceMode === "upload" && (
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 text-sm hover:bg-muted/50">
                    <UploadSimpleIcon className="size-4 text-primary" aria-hidden="true" />
                    <span className="truncate">
                      {uploadedName ?? "Choose .txt, .md, .pdf, or .docx"}
                    </span>
                    <input
                      type="file"
                      accept=".txt,.md,.pdf,.docx"
                      className="sr-only"
                      onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="d">Job description</Label>
                  <Textarea
                    id="d"
                    rows={6}
                    placeholder="Paste responsibilities, required skills, and preferred qualifications…"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                  />
                </div>

                <Button className="w-full" disabled={!title.trim() || !desc.trim()} onClick={create}>
                  Extract and save job
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-1.5 rounded-lg border bg-card p-1 text-sm">
          {[false, true].map((a) => (
            <button
              key={String(a)}
              type="button"
              onClick={() => setShowArchived(a)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                a === showArchived
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {a ? "Archived" : "Active"} ({jobs.filter((j) => j.archived === a).length})
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder="Filter by role or company"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<BriefcaseIcon className="size-5" aria-hidden="true" />}
          title={
            showArchived
              ? "No archived jobs."
              : query
                ? "No jobs match that filter."
                : "No jobs yet. Create one to start preparing."
          }
        />
      ) : (
        <>
          {/* Mobile card list */}
          <ul className="space-y-3 md:hidden">
            {list.map((j) => {
              const comp = jobCompleteness(j);
              const matches = matchJob(j, profile);
              const matched = matches.filter((m) => m.state === "matched").length;
              return (
                <li key={j.id}>
                  <Link
                    to="/app/jobs/$jobId"
                    params={{ jobId: j.id }}
                    className="panel block space-y-2.5 p-4 active:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{j.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {j.company} · {j.seniority}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular">
                        {format(new Date(j.updatedAt), "d MMM")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      {comp >= 75 ? (
                        <Status tone="success">Complete</Status>
                      ) : (
                        <Status tone="warning">Needs detail</Status>
                      )}
                      <span className="font-mono text-xs text-muted-foreground tabular">
                        {matched}/{matches.length} matched
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Desktop table */}
          <div className="panel hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/60 text-left">
                <tr className="eyebrow">
                  <th className="px-5 py-3 font-medium">Role & Company</th>
                  <th className="px-5 py-3 font-medium">Match</th>
                  <th className="px-5 py-3 font-medium">Context</th>
                  <th className="px-5 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((j) => {
                  const comp = jobCompleteness(j);
                  const matches = matchJob(j, profile);
                  const matched = matches.filter((m) => m.state === "matched").length;
                  return (
                    <tr key={j.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-5 py-3.5">
                        <Link
                          to="/app/jobs/$jobId"
                          params={{ jobId: j.id }}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {j.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {j.company} · {j.seniority}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground tabular">
                        {matched}/{matches.length} matched
                      </td>
                      <td className="px-5 py-3.5">
                        {comp >= 75 ? (
                          <Status tone="success">Complete</Status>
                        ) : (
                          <Status tone="warning">Needs detail</Status>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground tabular">
                        {format(new Date(j.updatedAt), "d MMM yyyy")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageTransition>
  );
}
