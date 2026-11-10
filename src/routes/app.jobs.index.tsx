import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState, PageHeader, Status } from "@/components/vren";
import { setState, uid, useAppState } from "@/lib/store";

export const Route = createFileRoute("/app/jobs/")({
  head: () => ({
    meta: [
      { title: "Jobs — Vren AI" },
      { name: "description", content: "Manage the job descriptions you're preparing for." },
      { property: "og:title", content: "Jobs — Vren AI" },
      { property: "og:description", content: "Active and archived jobs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Jobs,
});

const KEYWORDS = ["design systems", "user research", "stakeholder", "leadership", "sql", "mentoring", "react", "typescript", "python", "fintech", "analytics", "communication"];

function Jobs() {
  const { jobs } = useAppState();
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [desc, setDesc] = useState("");
  const list = jobs.filter((j) => j.archived === showArchived);

  const create = () => {
    const found = KEYWORDS.filter((k) => desc.toLowerCase().includes(k)).map((k) => k.replace(/\b\w/g, (c) => c.toUpperCase()));
    const id = uid();
    setState((s) => ({
      ...s,
      jobs: [
        { id, title, company, description: desc, archived: false, updatedAt: new Date().toISOString(), required: found.slice(0, 4), preferred: found.slice(4), themes: [] },
        ...s.jobs,
      ],
    }));
    setOpen(false);
    navigate({ to: "/app/jobs/$jobId", params: { jobId: id } });
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Jobs"
        title="Job descriptions"
        description="Each job is saved independently and reusable across sessions."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus /> Create job</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create job</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label htmlFor="t">Title</Label><Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label htmlFor="c">Company</Label><Input id="c" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d">Paste the job description</Label>
                  <Textarea id="d" rows={8} value={desc} onChange={(e) => setDesc(e.target.value)} />
                </div>
                <Button className="w-full" disabled={!title || !desc} onClick={create}>Extract and save</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="flex gap-2 text-sm">
        {[false, true].map((a) => (
          <button key={String(a)} onClick={() => setShowArchived(a)} className={a === showArchived ? "font-medium underline underline-offset-4" : "text-muted-foreground"}>
            {a ? "Archived" : "Active"} ({jobs.filter((j) => j.archived === a).length})
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <EmptyState title={showArchived ? "No archived jobs." : "No jobs yet. Create one to start preparing."} />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr className="eyebrow">
                <th className="px-5 py-2.5 font-medium">Title</th>
                <th className="px-5 py-2.5 font-medium">Company</th>
                <th className="px-5 py-2.5 font-medium">Context</th>
                <th className="px-5 py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((j) => {
                const complete = j.required.length >= 3;
                return (
                  <tr key={j.id} className="hover:bg-muted">
                    <td className="px-5 py-3"><Link to="/app/jobs/$jobId" params={{ jobId: j.id }} className="font-medium hover:underline">{j.title}</Link></td>
                    <td className="px-5 py-3 text-muted-foreground">{j.company}</td>
                    <td className="px-5 py-3">{complete ? <Status tone="success">Complete</Status> : <Status tone="warning">Needs detail</Status>}</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{format(new Date(j.updatedAt), "d MMM yyyy")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
