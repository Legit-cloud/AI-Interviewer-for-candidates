import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PageHeader, Status } from "@/components/vren";
import { auth, getState, setState, useAppState } from "@/lib/store";

export const Route = createFileRoute("/app/settings")({
  head: () => ({
    meta: [
      { title: "Settings & privacy — Vren AI" },
      { name: "description", content: "Account, extension access, response defaults and data controls." },
      { property: "og:title", content: "Settings & privacy — Vren AI" },
      { property: "og:description", content: "Manage your account and data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function Settings() {
  const { user, extension, prep } = useAppState();
  const navigate = useNavigate();

  const exportData = () => {
    const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vren-export.json";
    a.click();
  };

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Settings" title="Settings & privacy" />

      <section>
        <h2 className="eyebrow mb-1">Account</h2>
        <div className="panel divide-y px-5">
          <Row title="Email"><Input className="md:w-72" value={user?.email ?? ""} disabled /></Row>
          <Row title="Password" desc="Requires your current password."><Button variant="outline" size="sm" onClick={() => toast("Password change will be available once the backend is connected.")}>Change password</Button></Row>
        </div>
      </section>

      <section>
        <h2 className="eyebrow mb-1">Extension access</h2>
        <div className="panel divide-y px-5">
          <Row title="Chrome extension" desc={extension.connectedAt ? `Connected ${format(new Date(extension.connectedAt), "d MMM yyyy")} · v${extension.version}` : "Not connected"}>
            {extension.connected ? (
              <Button variant="outline" size="sm" onClick={() => setState((s) => ({ ...s, extension: { connected: false } }))}>Revoke access</Button>
            ) : (
              <Status>Not connected</Status>
            )}
          </Row>
        </div>
      </section>

      <section>
        <h2 className="eyebrow mb-1">Response defaults & retention</h2>
        <div className="panel divide-y px-5">
          <Row title="Default answer length"><span className="text-sm text-muted-foreground">{prep?.length ?? "Brief"}</span></Row>
          <Row title="Keep transcripts by default" desc="You can still choose per session.">
            <Label className="sr-only" htmlFor="ret">Keep transcripts</Label>
            <Switch id="ret" checked={prep?.retainTranscript ?? false} onCheckedChange={(v) => setState((s) => ({ ...s, prep: s.prep ? { ...s.prep, retainTranscript: v } : s.prep }))} disabled={!prep} />
          </Row>
          <Row title="Raw audio" desc="Never retained. Sent only for live transcription."><Status tone="success">Not stored</Status></Row>
          <Row title="Consent history"><span className="font-mono text-xs text-muted-foreground">Accepted terms · {format(new Date(), "d MMM yyyy")}</span></Row>
          <Row title="Export your data"><Button variant="outline" size="sm" onClick={exportData}>Download export</Button></Row>
        </div>
      </section>

      <section>
        <h2 className="eyebrow mb-1 text-destructive">Danger zone</h2>
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium">Delete account</p>
            <p className="text-xs text-muted-foreground">Permanently deletes your profile, CVs, jobs, sessions and notes.</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive">Delete account</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>Everything is deleted and can't be recovered. The Chrome extension will be disconnected.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { auth.signOut(); navigate({ to: "/", replace: true }); }}>
                  Delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          <a href="#" className="hover:underline">Privacy policy</a> · <a href="#" className="hover:underline">Terms</a>
        </p>
      </section>
    </div>
  );
}
