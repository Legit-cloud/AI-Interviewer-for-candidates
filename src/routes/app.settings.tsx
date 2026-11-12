import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { format } from "date-fns";
import { useState, type ReactNode } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PrivacyDialog, TermsDialog } from "@/components/legal-dialogs";
import { DetailSkeleton } from "@/components/loading";
import { PageTransition } from "@/components/motion";
import { PageHeader, Status } from "@/components/vren";
import {
  ANSWER_LENGTHS,
  auth,
  deleteAccount,
  deleteAllSessions,
  exportData,
  FRAMEWORKS,
  LANGUAGES,
  RESPONSE_STYLES,
  updatePreferences,
  useAppState,
} from "@/lib/store";

export const Route = createFileRoute("/app/settings")({
  head: () => ({
    meta: [
      { title: "Settings & privacy | Vren AI" },
      { name: "description", content: "Account, response defaults and data controls." },
      { property: "og:title", content: "Settings & privacy | Vren AI" },
      { property: "og:description", content: "Manage your account and data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
  pendingComponent: DetailSkeleton,
});

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string | undefined;
  children: ReactNode;
}) {
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
  const { user, preferences, consents, sessions } = useAppState();
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
        description="Control response defaults, retention timelines, and data deletion."
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
            <Input
              className="md:w-72"
              aria-label="Email address"
              value={user?.email ?? ""}
              disabled
            />
          </Row>
          <Row title="Password" desc="Requires verifying your current password.">
            <ChangePasswordDialog />
          </Row>
        </div>
      </section>

      {/* Response defaults */}
      <section className="space-y-2">
        <h2 className="eyebrow">Preparation defaults</h2>
        <div className="panel divide-y px-5">
          <Row
            title="Interview language"
            desc="The language the interviewer speaks. Used for transcription."
          >
            <select
              aria-label="Interview language"
              value={preferences.language}
              onChange={(e) => updatePreferences({ language: e.target.value })}
              className="h-10 rounded-md border border-input bg-card px-3 text-base md:h-9 md:text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </Row>
          <Row
            title="Answer language"
            desc="The language answers are written in. Leave on the same language unless you want them translated."
          >
            <select
              aria-label="Answer language"
              value={preferences.answerLanguage}
              onChange={(e) => updatePreferences({ answerLanguage: e.target.value })}
              className="h-10 rounded-md border border-input bg-card px-3 text-base md:h-9 md:text-sm"
            >
              <option value="">Same as interview language</option>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
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
          <Row
            title="Raw audio"
            desc="Never stored on disk. Discarded immediately after transcription."
          >
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
          <Row
            title="Retained session window"
            desc="Auto-expire retained transcripts after this window."
          >
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
          <Row
            title="Export all your data"
            desc="Includes profile, jobs, sessions, notes, and consent history."
          >
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
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
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
                    Every recorded session, note, and retained transcript will be removed
                    permanently.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      deleteAllSessions().then(
                        () => toast("All sessions deleted."),
                        (err) =>
                          toast.error(
                            err instanceof Error ? err.message : "Could not delete sessions.",
                          ),
                      );
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
            desc="Permanently deletes your profile, CVs, jobs, sessions, and notes."
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
                    Everything is deleted and cannot be recovered.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      deleteAccount().then(
                        () => {
                          toast("Account deleted.");
                          navigate({ to: "/", replace: true });
                        },
                        (err) =>
                          toast.error(
                            err instanceof Error ? err.message : "Could not delete the account.",
                          ),
                      );
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

function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (next.length < 8) return setError("Use at least 8 characters for the new password.");
    if (next !== confirm) return setError("The new passwords do not match.");
    setSaving(true);
    try {
      await auth.changePassword(current, next);
      toast.success("Password updated. Other devices have been signed out.");
      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Change password
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              You will stay signed in here. Every other device is signed out.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pw-current">Current password</Label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-new">New password</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-confirm">Confirm new password</Label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={saving || !current || !next || !confirm}>
              {saving ? "Saving…" : "Update password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
