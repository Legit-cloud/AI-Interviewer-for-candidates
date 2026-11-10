import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Mail, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/vren";
import { auth, useAppState } from "@/lib/store";

type Mode = "signin" | "signup" | "forgot" | "verify";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { mode?: Mode | undefined } => ({
    mode: ["signin", "signup", "forgot", "verify"].includes(s["mode"] as string) ? (s["mode"] as Mode) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Vren AI" },
      { name: "description", content: "Sign in or create your Vren AI account." },
      { property: "og:title", content: "Sign in — Vren AI" },
      { property: "og:description", content: "Access your interview workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode = "signin" } = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useAppState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = (m: Mode) => {
    setError(null);
    navigate({ to: "/auth", search: { mode: m } });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
    if (mode !== "forgot" && password.length < 8)
      return setError(mode === "signup" ? "Use at least 8 characters for your password." : "We could not sign you in. Check your details or reset your password.");
    setPending(true);
    await new Promise((r) => setTimeout(r, 600));
    setPending(false);
    if (mode === "signup") {
      auth.signUp(email);
      go("verify");
    } else if (mode === "signin") {
      auth.signIn(email);
      navigate({ to: "/app" });
    } else {
      toast.success("If an account exists, a reset link is on its way.");
      go("signin");
    }
  };

  const titles: Record<Mode, [string, string]> = {
    signin: ["Welcome back", "Sign in to your interview workspace."],
    signup: ["Create your account", "Set up once, reuse across every application."],
    forgot: ["Reset your password", "We'll email you a secure link."],
    verify: ["Check your email", `We sent a verification link to ${user?.email ?? "your inbox"}.`],
  };

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-ink p-10 text-ink-foreground md:flex">
        <Logo />
        <blockquote className="max-w-md">
          <p className="text-2xl font-semibold leading-snug">
            "Candidate truth over fluency. If it isn't in your experience, Vren won't put it in your mouth."
          </p>
          <p className="mt-4 font-mono text-xs opacity-60">PRODUCT PRINCIPLE 01</p>
        </blockquote>
        <p className="font-mono text-xs opacity-50">Raw audio is never retained by default.</p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 md:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{titles[mode][0]}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{titles[mode][1]}</p>

          {mode === "verify" ? (
            <div className="mt-8 space-y-4">
              <div className="panel flex items-start gap-3 p-4 text-sm">
                <Mail className="mt-0.5 size-4 text-primary" />
                <p className="text-muted-foreground">Open the link to continue. It expires in 24 hours. Your progress is kept.</p>
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  auth.verify();
                  navigate({ to: "/onboarding" });
                }}
              >
                I've verified my email
              </Button>
              <Button variant="outline" className="w-full" onClick={() => toast("Verification email resent.")}>
                Resend email
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </div>
              {mode !== "forgot" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    {mode === "signin" && (
                      <button type="button" onClick={() => go("forgot")} className="text-xs text-primary hover:underline">
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  {mode === "signup" && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
                </div>
              )}
              {error && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signin" ? (
              <>
                New to Vren AI?{" "}
                <button onClick={() => go("signup")} className="font-medium text-primary hover:underline">Create account</button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button onClick={() => go("signin")} className="font-medium text-primary hover:underline">Sign in</button>
              </>
            )}
          </p>
          <p className="mt-10 text-center text-xs text-muted-foreground">
            <Link to="/" className="hover:underline">← Back to home</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
