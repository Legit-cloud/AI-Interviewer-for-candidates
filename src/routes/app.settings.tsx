import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DownloadSimpleIcon, PuzzlePieceIcon, ShieldCheckIcon, TrashIcon } from "@phosphor-icons/react";
import { format } from "date-fns";
import type { ReactNode } from "react";
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
import { Switch } from "@/components/ui/switch";
import { PrivacyDialog, TermsDialog } from "@/components/legal-dialogs";
import { PageTransition } from "@/components/motion";
import { PageHeader, Status } from "@/components/vren";
import {
  ANSWER_LENGTHS,
  connectExtension,
  deleteAccount,
  deleteAllSessions,
  exportData,
  FRAMEWORKS,
  LANGUAGES,
  RESPONSE_STYLES,
  revokeExtension,
  updatePreferences,
  useAppState,
} from "@/lib/store";

export const Route = createFileRoute("/app/settings")({
  head: () => ({
    meta: [
      { title: "Settings & privacy | Vren AI" },
      { name: "description", content: "Account, extension access, response defaults and data controls." },
      { property: "og:title", content: "Settings & privacy | Vren AI" },
      { property: "og:description", content: "Manage your account and data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

function Row({ title, desc, children }: { title: string; desc?: string | undefined; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Settings() {
  const { user, extension, preferences, consents, sessions } = useAppState();
  const navigate = useNavigate();

  const downloadExport = () => {
    const blob = new Blob([exportData()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vren-export.json";
    a.click();
    toast.success("Export downloaded (vren-export.json).");
  };

  return (
    <PageTransition className="space-y-10">
      <PageHeader
        eyebrow="Settings"
        title="Settings & privacy"
        description="Control extension permissions, response defaults, retention timelines, and data deletion."
      />

      {/* Account */}
      <section className="space-y-2">
        <h2 className="eyebrow">Account</h2>
        <div className="panel divide-y px-5">
          <Row
            title="Email"
            desc={
              user?.createdAt
                ? `Account created ${format(new Date(user.createdAt), "d MMM yyyy")}`
                : undefined
            }
          >
            <Input className="md:w-72" value={user?.email ?? ""} disabled />
          </Row>
          <Row title="Password" desc="Requires verifying your current password.">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast("Password change will connect once backend auth is wired.")}
            >
              Change password
            </Button>
          </Row>
        </div>
      </section>

      {/* Extension access */}
      <section className="space-y-2">
        <h2 className="eyebrow">Chrome extension access</h2>
        <div className="panel divide-y px-5">
          <Row
            title="Extension status"
            desc={
              extension.connected && extension.connectedAt
                ? `Connected ${format(new Date(extension.connectedAt), "d MMM yyyy, HH:mm")} · v${extension.version}. Browsing history is never recorded.`
                : "Not connected. Connect from the Chrome Side Panel or below."
            }
          >
            {extension.connected ? (
              <div className="flex items-center gap-2.5">
                <Status tone="success">Connected</Status>
                <Button variant="outline" size="sm" onClick={revokeExtension}>
                  Revoke access
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={connectExtension}>
                <PuzzlePieceIcon className="size-4" aria-hidden="true" />
                Connect extension
              </Button>
            )}
          </Row>
        </div>
      </section>

      {/* Response defaults */}
      <section className="space-y-2">
        <h2 className="eyebrow">Preparation defaults</h2>
        <div className="panel divide-y px-5">
          <Row title="Default language">
            <select
              aria-label="Default language"
              value={preferences.language}
              onChange={(e) => updatePreferences({ language: e.target.value })}
              className="h-10 rounded-md border border-input bg-card px-3 text-base md:h-9 md:text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </Row>
          <Row title="Default answer length">
            <select
              aria-label="Default answer length"
              value={preferences.length}
              onChange={(e) => updatePreferences({ length: e.target.value })}
              className="h-10 rounded-md border border-input bg-card px-3 text-base md:h-9 md:text-sm"
            >
              {ANSWER_LENGTHS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </Row>
          <Row title="Default response style">
            <select
              aria-label="Default response style"
              value={preferences.style}
              onChange={(e) => updatePreferences({ style: e.target.value })}
              className="h-10 rounded-md border border-input bg-card px-3 text-base md:h-9 md:text-sm"
            >
              {RESPONSE_STYLES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Row>
          <Row title="Default framework">
            <select
              aria-label="Default framework"
              value={preferences.framework}
              onChange={(e) => updatePreferences({ framework: e.target.value })}
              className="h-10 rounded-md border border-input bg-card px-3 text-base md:h-9 md:text-sm"
            >
              {FRAMEWORKS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Row>
        </div>
      </section>

      {/* Privacy & Data retention */}
      <section className="space-y-2">
        <h2 className="eyebrow">Data retention & privacy</h2>
        <div className="panel divide-y px-5">
          <Row title="Raw audio" desc="Never stored on disk. Discarded immediately after transcription.">
            <Status tone="success">
              <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
              Not stored
            </Status>
          </Row>
          <Row
            title="Keep transcripts by default"
            desc="Off by default. You can always override this per interview."
          >
            <Label className="sr-only" htmlFor="ret-default">
              Keep transcripts by default
            </Label>
            <Switch
              id="ret-default"
              checked={preferences.retainTranscriptDefault}
              onCheckedChange={(v) => updatePreferences({ retainTranscriptDefault: v })}
            />
          </Row>
          <Row title="Retained session window" desc="Auto-expire retained transcripts after this window.">
            <select
              aria-label="Retention window"
              value={preferences.retentionDays}
              onChange={(e) =>
                updatePreferences({ retentionDays: Number(e.target.value) as 30 | 90 | 365 })
              }
              className="h-10 rounded-md border border-input bg-card px-3 text-base md:h-9 md:text-sm"
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>365 days</option>
            </select>
          </Row>
          <Row title="Export all your data" desc="Includes profile, jobs, sessions, notes, and consent history.">
            <Button variant="outline" size="sm" onClick={downloadExport}>
              <DownloadSimpleIcon className="size-4" aria-hidden="true" />
              Download JSON
            </Button>
          </Row>
        </div>
      </section>

      {/* Consent history */}
      <section className="space-y-2">
        <h2 className="eyebrow">Consent & audit history</h2>
        <div className="panel divide-y px-5">
          {consents.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div>
                <p className="font-medium text-foreground">{c.label}</p>
                <p className="text-xs text-muted-foreground">{c.detail}</p>
              </div>
              <span className="font-mono text-xs text-muted-foreground tabular">
                {format(new Date(c.at), "d MMM yyyy, HH:mm")}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Danger Zone */}
      <section className="space-y-3">
        <h2 className="eyebrow text-destructive">Danger zone</h2>
        <div className="divide-y rounded-xl border border-destructive/30 bg-destructive/4 px-5">
          <Row
            title={`Delete all sessions (${sessions.length})`}
            desc="Clears all session history, feedback, notes, and transcripts. Your profile and jobs stay."
          >
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={sessions.length === 0}>
                  Clear sessions
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete all session history?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every recorded session, note, and retained transcript will be removed permanently.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      deleteAllSessions();
                      toast("All sessions deleted.");
                    }}
                  >
                    Delete sessions
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Row>

          <Row
            title="Delete account"
            desc="Permanently deletes your profile, CVs, jobs, sessions, notes, and revokes extension access."
          >
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <TrashIcon className="size-4" aria-hidden="true" />
                  Delete account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your Vren AI account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Everything is deleted and cannot be recovered. Any connected Chrome extension is
                    disconnected immediately.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      deleteAccount();
                      toast("Account deleted.");
                      navigate({ to: "/", replace: true });
                    }}
                  >
                    Delete everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Row>
        </div>

        <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
          <PrivacyDialog
            trigger={
              <button type="button" className="hover:text-foreground hover:underline">
                Privacy commitments
              </button>
            }
          />
          <span>·</span>
          <TermsDialog
            trigger={
              <button type="button" className="hover:text-foreground hover:underline">
                Terms & boundaries
              </button>
            }
          />
        </div>
      </section>
    </PageTransition>
  );
}
