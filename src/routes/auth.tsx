import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/EyeSlash";
import { SpinnerGapIcon } from "@phosphor-icons/react/SpinnerGap";
import { SparkleIcon } from "@phosphor-icons/react/Sparkle";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnimatePresence, motion, EASE } from "@/components/motion";
import { Logo } from "@/components/vren";
import { auth, delay, useAppState } from "@/lib/store";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup" | "forgot" | "verify";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { mode?: Mode | undefined } => ({
    mode: ["signin", "signup", "forgot", "verify"].includes(s["mode"] as string)
      ? (s["mode"] as Mode)
      : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in | Vren AI" },
      { name: "description", content: "Sign in or create your Vren AI account." },
      { property: "og:title", content: "Sign in | Vren AI" },
      { property: "og:description", content: "Access your interview workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function passwordStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

function AuthPage() {
  const { mode = "signin" } = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useAppState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const go = (m: Mode) => {
    setError(null);
    navigate({ to: "/auth", search: { mode: m } });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      emailRef.current?.focus();
      return;
    }
    if (mode !== "forgot" && password.length < 8) {
      setError(
        mode === "signup"
          ? "Use at least 8 characters for your password."
          : "We could not sign you in. Check your details or reset your password.",
      );
      passwordRef.current?.focus();
      return;
    }
    setPending(true);
    await delay(550);
    setPending(false);
    if (mode === "signup") {
      auth.signUp(email.trim());
      setResendCooldown(30);
      go("verify");
    } else if (mode === "signin") {
      auth.signIn(email.trim());
      navigate({ to: "/app" });
    } else {
      toast.success("If an account exists for that email, a reset link is on its way.");
      go("signin");
    }
  };

  const enterDemo = async () => {
    setPending(true);
    await delay(350);
    auth.signIn("ada.obi@vren.demo");
    setPending(false);
    navigate({ to: "/app" });
  };

  const titles: Record<Mode, [string, string]> = {
    signin: ["Welcome back", "Sign in to your interview workspace."],
    signup: ["Create your account", "Set up your profile once and reuse it across roles."],
    forgot: ["Reset your password", "We’ll email you a secure single-use link."],
    verify: ["Check your inbox", `We sent a verification link to ${user?.email ?? "your email"}.`],
  };

  const strength = passwordStrength(password);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Editorial left panel */}
      <aside className="grain relative hidden flex-col justify-between overflow-hidden bg-pine p-10 text-pine-foreground lg:flex">
        <Logo inverted />

        <div className="relative z-10 max-w-md space-y-6">
          <div className="aspect-[16/10] overflow-hidden rounded-xl border border-white/12 bg-ink/40">
            <img
              src="/images/workspace.jpg"
              alt="Calm modern workspace by a window"
              loading="eager"
              decoding="async"
              className="h-full w-full object-cover opacity-90"
            />
          </div>
          <blockquote>
            <p className="font-display text-2xl leading-snug text-white">
              “Candidate truth over fluency. If it isn’t in your experience, Vren won’t put it in
              your mouth.”
            </p>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-pine-foreground/65">
              Product principle 01
            </p>
          </blockquote>
        </div>

        <p className="font-mono text-xs text-pine-foreground/60">
          Raw audio is discarded by default. You control every capture switch.
        </p>
      </aside>

      {/* Auth Form */}
      <main className="flex flex-col justify-between px-6 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="lg:hidden">
            <Logo />
          </div>
          <Link
            to="/"
            className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
            Back to home
          </Link>
        </div>

        <div className="mx-auto my-10 w-full max-w-sm">
          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              <h1 className="font-display text-3xl tracking-tight text-foreground">
                {titles[mode][0]}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">{titles[mode][1]}</p>

              {mode === "verify" ? (
                <div className="mt-7 space-y-4">
                  <div className="panel flex items-start gap-3 p-4 text-sm">
                    <EnvelopeSimpleIcon
                      className="mt-0.5 size-5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <div className="space-y-1 text-muted-foreground">
                      <p>Open the verification link to continue. It expires in 24 hours.</p>
                      <p className="font-mono text-xs text-foreground">
                        Your progress is kept even if you resume later.
                      </p>
                    </div>
                  </div>

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={() => {
                      auth.verify();
                      navigate({ to: "/onboarding" });
                    }}
                  >
                    <CheckCircleIcon className="size-4" aria-hidden="true" />
                    Continue after verification
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={resendCooldown > 0}
                    onClick={() => {
                      setResendCooldown(30);
                      toast.success("Verification email resent.");
                    }}
                  >
                    {resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : "Resend email"}
                  </Button>
                </div>
              ) : (
                <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      ref={emailRef}
                      id="email"
                      type="email"
                      placeholder="you@domain.com"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={error?.includes("email") ? true : undefined}
                      autoFocus
                    />
                  </div>

                  {mode !== "forgot" && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="password">Password</Label>
                        {mode === "signin" && (
                          <button
                            type="button"
                            onClick={() => go("forgot")}
                            className="text-xs text-primary hover:underline"
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <Input
                          ref={passwordRef}
                          id="password"
                          type={showPw ? "text" : "password"}
                          autoComplete={mode === "signup" ? "new-password" : "current-password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw((v) => !v)}
                          aria-label={showPw ? "Hide password" : "Show password"}
                          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                        >
                          {showPw ? (
                            <EyeSlashIcon className="size-4" aria-hidden="true" />
                          ) : (
                            <EyeIcon className="size-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>

                      {mode === "signup" && (
                        <div className="space-y-1 pt-1">
                          <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
                            {[1, 2, 3].map((step) => (
                              <div
                                key={step}
                                className={cn(
                                  "h-1 rounded-full transition-colors",
                                  strength >= step
                                    ? strength === 3
                                      ? "bg-success"
                                      : strength === 2
                                        ? "bg-primary"
                                        : "bg-warning"
                                    : "bg-border",
                                )}
                              />
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            At least 8 characters. Mix uppercase, lowercase, and numbers.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {error && (
                    <p
                      role="alert"
                      className="rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive"
                    >
                      {error}
                    </p>
                  )}

                  <Button type="submit" size="lg" className="w-full" disabled={pending}>
                    {pending && <SpinnerGapIcon className="size-4 animate-spin" aria-hidden="true" />}
                    {mode === "signin"
                      ? "Sign in"
                      : mode === "signup"
                        ? "Create account"
                        : "Send reset link"}
                  </Button>

                  {mode === "signin" && (
                    <div className="pt-2">
                      <div className="relative my-3 flex items-center justify-center">
                        <span className="h-px w-full bg-border" />
                        <span className="bg-background px-2 font-mono text-[11px] uppercase text-muted-foreground">
                          or
                        </span>
                        <span className="h-px w-full bg-border" />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        disabled={pending}
                        onClick={enterDemo}
                      >
                        <SparkleIcon className="size-4 text-primary" aria-hidden="true" />
                        Load populated demo workspace
                      </Button>
                    </div>
                  )}
                </form>
              )}

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {mode === "signin" ? (
                  <>
                    New to Vren AI?{" "}
                    <button
                      type="button"
                      onClick={() => go("signup")}
                      className="font-medium text-primary hover:underline"
                    >
                      Create account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => go("signin")}
                      className="font-medium text-primary hover:underline"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        <p className="text-center font-mono text-[11px] text-muted-foreground">
          Local prototype mode · Data stays in your browser
        </p>
      </main>
    </div>
  );
}
