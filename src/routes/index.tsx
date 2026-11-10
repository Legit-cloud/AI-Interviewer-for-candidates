import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileText, Briefcase, Radio, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo, Status } from "@/components/vren";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vren AI — Interview guidance grounded in your experience" },
      { name: "description", content: "Bring your CV and the job description. Vren AI gives you short, evidence-based talking points during browser interviews — never invented claims." },
      { property: "og:title", content: "Vren AI — Interview guidance grounded in your experience" },
      { property: "og:description", content: "Short, honest talking points from your own background, with capture you control." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const principles = [
  { n: "01", t: "Candidate truth over fluency", d: "If your profile can't support a claim, Vren says so — and asks you to add evidence instead of inventing it." },
  { n: "02", t: "Explicit control", d: "Capture only starts when you click. Tab audio and microphone are separate switches, always visible, always stoppable." },
  { n: "03", t: "Short guidance", d: "Three to five bullets, a framework, and the evidence it used. Built to be scanned while you speak." },
];

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Logo />
          <nav className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link to="/auth" search={{ mode: "signin" }}>Sign in</Link>
            </Button>
            <Button asChild>
              <Link to="/auth" search={{ mode: "signup" }}>Create account</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="rule-grid border-b">
        <div className="mx-auto grid max-w-6xl gap-12 bg-background/0 px-6 py-20 md:grid-cols-[1.1fr_1fr] md:py-28">
          <div className="bg-background/90 md:-ml-4 md:p-4">
            <p className="eyebrow mb-5">Interview workspace · Web + Chrome</p>
            <h1 className="text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
              Think clearly.
              <br />
              Answer from <span className="text-primary">what you've actually done.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg text-muted-foreground">
              Vren AI pairs your CV with the job description and offers concise, evidence-backed talking points during browser interviews. It never speaks for you, and never makes things up.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link to="/auth" search={{ mode: "signup" }}>
                  Prepare your first interview <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how">How it works</a>
              </Button>
            </div>
          </div>

          {/* Live panel preview */}
          <div className="panel self-center p-0 shadow-[0_24px_60px_-30px_var(--color-ink)]">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Vren AI</span>
              <div className="flex items-center gap-2">
                <Status tone="success">Listening</Status>
                <span className="font-mono text-xs text-muted-foreground">12:48</span>
              </div>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <p className="eyebrow mb-1.5">Question · Behavioural</p>
                <p className="text-sm font-medium">"Tell me about a time you improved a key product metric."</p>
              </div>
              <div className="rounded-md border-l-2 border-primary bg-muted p-3">
                <p className="mb-2 font-mono text-[11px] text-primary">STAR</p>
                <ul className="space-y-1.5 text-sm">
                  <li>• Merchant onboarding drop-off sat at 41%</li>
                  <li>• You ran 12 merchant interviews, rebuilt the flow</li>
                  <li>• Drop-off fell to 23% in one quarter</li>
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">From your experience:</span> Paystack — onboarding redesign
              </p>
              <div className="space-y-1 border-t pt-3 font-mono text-[11px] text-muted-foreground">
                <p>
                  <span className="text-foreground">Interviewer</span> — tell me about a time you…
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between border-t px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
              <span>Tab audio: on · Mic: off</span>
              <span>Connected</span>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <p className="eyebrow mb-3">How it works</p>
        <h2 className="max-w-xl text-3xl font-bold tracking-tight">Prepare once. Reuse everywhere.</h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4">
          {[
            { i: FileText, t: "Add your CV", d: "We extract roles, skills and projects. You review and verify every field." },
            { i: Briefcase, t: "Add the job", d: "See matched evidence, partial matches and honest gaps." },
            { i: ShieldCheck, t: "Set preferences", d: "Interview type, answer length, framework, and transcript retention." },
            { i: Radio, t: "Open the assistant", d: "Start the Chrome side panel on your meeting tab when you're ready." },
          ].map(({ i: Icon, t, d }, idx) => (
            <div key={t} className="bg-card p-6">
              <div className="mb-6 flex items-center justify-between">
                <Icon className="size-5 text-primary" />
                <span className="font-mono text-xs text-muted-foreground">0{idx + 1}</span>
              </div>
              <h3 className="font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y bg-ink text-ink-foreground">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 md:grid-cols-3">
          {principles.map((p) => (
            <div key={p.n}>
              <p className="font-mono text-sm opacity-60">{p.n}</p>
              <h3 className="mt-3 text-xl font-semibold">{p.t}</h3>
              <p className="mt-2 text-sm opacity-75">{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <p className="eyebrow mb-3">Privacy by default</p>
            <h2 className="text-3xl font-bold tracking-tight">Your data stays yours.</h2>
          </div>
          <ul className="divide-y border-y text-sm">
            {[
              "Raw audio is not retained by default",
              "Transcript storage is your choice, per session",
              "No hidden capture, no screen-share evasion",
              "Delete any CV, job or session at any time",
            ].map((x) => (
              <li key={x} className="flex items-center gap-3 py-3.5">
                <ShieldCheck className="size-4 text-success" /> {x}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-muted-foreground md:flex-row md:justify-between">
          <Logo className="text-foreground" />
          <p className="font-mono text-xs">© 2026 Vren AI · Coaching, not a hiring assessment.</p>
        </div>
      </footer>
    </div>
  );
}
