import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BriefcaseIcon,
  CaretRightIcon,
  CheckCircleIcon,
  FileTextIcon,
  LockKeyIcon,
  MicrophoneIcon,
  PauseIcon,
  RadioIcon,
  ShieldCheckIcon,
  SpeakerHighIcon,
  StopIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PrivacyDialog, TermsDialog } from "@/components/legal-dialogs";
import { AnimatePresence, Reveal, Stagger, StaggerItem, motion, EASE } from "@/components/motion";
import { Logo, Status } from "@/components/vren";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vren AI | Interview guidance grounded in your experience" },
      {
        name: "description",
        content:
          "Bring your CV and the job description. Vren AI gives you short, evidence-based talking points during browser interviews, never invented claims.",
      },
      { property: "og:title", content: "Vren AI | Interview guidance grounded in your experience" },
      {
        property: "og:description",
        content: "Short, honest talking points from your own background, with capture you control.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const cues = [
  {
    id: "matched",
    status: "Listening",
    tone: "success" as const,
    time: "12:48",
    questionType: "Behavioural · Detected",
    question: "“Tell me about a time you improved a key product metric.”",
    framework: "STAR",
    bullets: [
      "Situation: merchant onboarding drop-off sat at 41%",
      "Action: ran 12 merchant interviews and rebuilt the flow",
      "Result: drop-off fell to 23% within one quarter",
    ],
    evidence: "From your verified CV: Paystack, onboarding redesign",
    missing: false,
    caption: "Interviewer: “Tell me about a time you improved a key product metric…”",
  },
  {
    id: "gap",
    status: "Listening",
    tone: "success" as const,
    time: "23:05",
    questionType: "Technical · Gap flagged",
    question: "“Have you written SQL to analyse product funnels yourself?”",
    framework: "Direct boundary",
    bullets: [
      "Be direct: SQL is not in your verified experience",
      "Cite how you partnered with analysts on funnel drops",
      "Note willingness to ramp up where the team needs it",
    ],
    evidence: "No matching evidence found. Vren will not fabricate SQL experience.",
    missing: true,
    caption: "Interviewer: “Have you written SQL to analyse funnels yourself?”",
  },
];

const workflow = [
  {
    step: "01",
    icon: FileTextIcon,
    title: "Upload and verify your CV",
    body: "PDF or DOCX up to 5 MB. Review every extracted role, date, and skill side-by-side before it becomes eligible for suggestions.",
  },
  {
    step: "02",
    icon: BriefcaseIcon,
    title: "Compare against the job",
    body: "Paste or upload a role description. See matched evidence, partial overlap, and honest gaps before the call begins.",
  },
  {
    step: "03",
    icon: RadioIcon,
    title: "Set format and privacy defaults",
    body: "Choose STAR or problem/approach/trade-off, response length, and whether transcripts should be kept after the session.",
  },
  {
    step: "04",
    icon: ShieldCheckIcon,
    title: "Open the Chrome side panel",
    body: "Start tab audio or mic explicitly on your meeting tab. Short talking points appear beside the call; stop anytime.",
  },
];

const personas = [
  {
    id: "prepared",
    label: "Prepared candidate",
    role: "Senior Product Designer · Fintech",
    image: "/images/persona-prepared.jpg",
    alt: "Product designer on a calm video interview at a sunlit birch desk with wired earphones and open notebook",
    need: "Reuses one verified profile across multiple active applications without re-uploading.",
    example: {
      prompt: "“Walk me through how you handle cross-functional pushback.”",
      cue: "Cite Paystack onboarding alignment with 3 PMs and Risk; shipped on schedule.",
    },
  },
  {
    id: "career",
    label: "Career changer",
    role: "Operations Lead to Product Manager",
    image: "/images/persona-changer.jpg",
    alt: "Candidate reviewing structured notes in a notebook beside a laptop in soft afternoon window light",
    need: "Surfaces transferable skills accurately while flagging genuine requirement gaps.",
    example: {
      prompt: "“Have you owned a formal SaaS pricing experiment?”",
      cue: "No direct pricing-test evidence. Pivot honestly to the vendor margin model you led.",
    },
  },
  {
    id: "technical",
    label: "Technical candidate",
    role: "Staff Backend Engineer",
    image: "/images/persona-technical.jpg",
    alt: "Software engineer seated at an oak desk by a bright window with monitor, laptop, and grid notebook",
    need: "Structures assumptions, trade-offs, and constraints without noisy long paragraphs.",
    example: {
      prompt: "“How would you handle backpressure in a live audio pipeline?”",
      cue: "Problem / approach / trade-off: bounded ring buffer with a visible degraded state.",
    },
  },
];

function Landing() {
  const [cueIndex, setCueIndex] = useState(0);
  const [personaId, setPersonaId] = useState(personas[0]!.id);
  const cue = cues[cueIndex] ?? cues[0]!;
  const activePersona = personas.find((p) => p.id === personaId) ?? personas[0]!;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Top navigation */}
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <nav
            aria-label="Primary"
            className="hidden items-center gap-7 text-sm text-muted-foreground md:flex"
          >
            <a href="#how" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#personas" className="transition-colors hover:text-foreground">
              Who it’s for
            </a>
            <a href="#privacy" className="transition-colors hover:text-foreground">
              Privacy & control
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/auth" search={{ mode: "signin" }}>
                Sign in
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/auth" search={{ mode: "signup" }}>
                Create account
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Editorial Hero */}
      <section className="rule-grid relative overflow-hidden border-b">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.08fr] lg:gap-12 lg:py-24">
          <Stagger className="relative z-10">
            <StaggerItem>
              <h1 className="font-display text-4xl leading-[1.04] tracking-tight text-foreground sm:text-5xl lg:text-[3.5rem]">
                Think clearly.
                <br />
                Answer from <span className="mark-copper">what you’ve actually done.</span>
              </h1>
            </StaggerItem>

            <StaggerItem>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Vren AI pairs your verified CV with the job description and delivers concise,
                evidence-backed talking points during browser interviews. It never speaks for you,
                and never invents experience.
              </p>
            </StaggerItem>

            <StaggerItem>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button size="lg" asChild>
                  <Link to="/auth" search={{ mode: "signup" }}>
                    Prepare your first interview
                    <ArrowRightIcon className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href="#how">See the workflow</a>
                </Button>
              </div>
            </StaggerItem>

            <StaggerItem>
              <dl className="mt-10 grid grid-cols-3 gap-4 border-t pt-6 text-xs">
                <div>
                  <dt className="font-mono uppercase tracking-wider text-muted-foreground">Audio</dt>
                  <dd className="mt-1 font-medium text-foreground">Discarded by default</dd>
                </div>
                <div>
                  <dt className="font-mono uppercase tracking-wider text-muted-foreground">
                    Evidence
                  </dt>
                  <dd className="mt-1 font-medium text-foreground">Verified CV only</dd>
                </div>
                <div>
                  <dt className="font-mono uppercase tracking-wider text-muted-foreground">
                    Capture
                  </dt>
                  <dd className="mt-1 font-medium text-foreground">Explicit start & stop</dd>
                </div>
              </dl>
            </StaggerItem>
          </Stagger>

          {/* Unified Browser Meeting Tab + Docked Vren AI Side Panel */}
          <Reveal delay={0.12} className="relative">
            <div className="panel overflow-hidden shadow-[0_24px_60px_-32px_rgba(18,26,24,0.28)]">
              {/* Minimal Browser Window Bar */}
              <div className="flex items-center justify-between border-b bg-sidebar px-4 py-2.5">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="size-2.5 rounded-full bg-border-strong" />
                  <span className="size-2.5 rounded-full bg-border-strong" />
                  <span className="size-2.5 rounded-full bg-border-strong" />
                </div>
                <span className="rounded-md border bg-card px-3 py-0.5 font-mono text-[11px] text-muted-foreground">
                  meet.google.com/interview-loop
                </span>
                <span className="font-mono text-[11px] text-primary">Side Panel</span>
              </div>

              <div className="grid sm:grid-cols-[0.88fr_1.12fr]">
                {/* Left: Calm Meeting Call Viewport (hidden on narrow mobile to keep hero tight) */}
                <div className="relative hidden flex-col justify-between overflow-hidden border-r bg-pine sm:flex">
                  <img
                    src="/images/persona-prepared.jpg"
                    alt="Candidate in a browser video interview"
                    loading="eager"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover object-center opacity-80"
                  />
                  <div className="relative z-10 flex items-center justify-between p-3.5">
                    <span className="rounded-md bg-ink/75 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur-xs">
                      Tab audio shared
                    </span>
                  </div>
                  <div className="relative z-10 bg-gradient-to-t from-ink/90 via-ink/60 to-transparent p-4 pt-12 text-white">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-white/70">
                      Live caption
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-white/95">{cue.caption}</p>
                  </div>
                </div>

                {/* Right: Docked Chrome Side Panel */}
                <div className="flex flex-col justify-between bg-card">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <span className="text-xs font-semibold tracking-tight text-foreground">
                      Vren AI
                    </span>
                    <div className="flex items-center gap-2">
                      <Status tone={cue.tone} pulse>
                        {cue.status}
                      </Status>
                      <span className="font-mono text-[11px] text-muted-foreground tabular">
                        {cue.time}
                      </span>
                    </div>
                  </div>

                  <AnimatePresence mode="wait">
                    <motion.div
                      key={cue.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.22, ease: EASE }}
                      className="space-y-3.5 p-4"
                    >
                      <div>
                        <p className="eyebrow mb-1">{cue.questionType}</p>
                        <p className="text-sm font-medium leading-snug text-foreground">
                          {cue.question}
                        </p>
                      </div>

                      <div
                        className={cn(
                          "rounded-lg border-l-2 p-3",
                          cue.missing ? "border-warning bg-warning/6" : "border-primary bg-muted/70",
                        )}
                      >
                        <p
                          className={cn(
                            "mb-1.5 font-mono text-[11px] font-medium",
                            cue.missing ? "text-warning" : "text-primary",
                          )}
                        >
                          {cue.framework}
                        </p>
                        <ul className="space-y-1 text-[13px] leading-relaxed text-foreground">
                          {cue.bullets.map((b) => (
                            <li key={b} className="flex gap-2">
                              <span className="text-muted-foreground" aria-hidden="true">
                                •
                              </span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="flex items-start gap-2 text-xs">
                        {cue.missing ? (
                          <WarningCircleIcon
                            className="mt-0.5 size-4 shrink-0 text-warning"
                            weight="fill"
                            aria-hidden="true"
                          />
                        ) : (
                          <CheckCircleIcon
                            className="mt-0.5 size-4 shrink-0 text-success"
                            weight="fill"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={cn(
                            cue.missing ? "font-medium text-warning" : "text-muted-foreground",
                          )}
                        >
                          {cue.evidence}
                        </span>
                      </div>
                    </motion.div>
                  </AnimatePresence>

                  <div className="flex items-center justify-between border-t bg-muted/40 px-4 py-2.5 text-[11px]">
                    <span className="flex items-center gap-1.5 font-mono text-muted-foreground">
                      <SpeakerHighIcon className="size-3.5" aria-hidden="true" />
                      Tab: on · Mic: off
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCueIndex((i) => (i + 1) % cues.length)}
                        className="inline-flex min-h-8 items-center gap-1 rounded-md border bg-card px-2 font-mono text-[11px] text-foreground transition-colors hover:bg-muted"
                      >
                        {cue.missing ? "Matched cue" : "Gap example"}
                        <CaretRightIcon className="size-3" aria-hidden="true" />
                      </button>
                      <span className="inline-flex items-center gap-1.5 text-foreground" aria-hidden="true">
                        <PauseIcon className="size-3.5" />
                        <StopIcon className="size-3.5 text-destructive" weight="fill" />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Workflow Section */}
      <section id="how" className="border-b py-16 lg:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal className="max-w-2xl">
            <p className="eyebrow mb-3">One product · Two surfaces</p>
            <h2 className="font-display text-3xl tracking-tight text-foreground sm:text-4xl">
              Prepare calmly in the dashboard. Stay grounded in the call.
            </h2>
            <p className="mt-3 text-base text-muted-foreground">
              Your structured profile, job match, and privacy preferences stay synced between the
              web workspace and the Chrome Side Panel.
            </p>
          </Reveal>

          <Stagger inView className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {workflow.map((item) => {
              const Icon = item.icon;
              return (
                <StaggerItem key={item.step}>
                  <div className="panel-interactive flex h-full flex-col justify-between p-6">
                    <div>
                      <div className="mb-5 flex items-center justify-between">
                        <span className="grid size-9 place-items-center rounded-lg border bg-primary-soft/60 text-primary">
                          <Icon className="size-4.5" aria-hidden="true" />
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">{item.step}</span>
                      </div>
                      <h3 className="text-base font-semibold tracking-tight text-foreground">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {item.body}
                      </p>
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </Stagger>
        </div>
      </section>

      {/* Persona Section with Cohesive Uniformly Sized Photography */}
      <section id="personas" className="border-b bg-card py-16 lg:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <Reveal className="max-w-xl">
              <p className="eyebrow mb-3">Built for real candidates</p>
              <h2 className="font-display text-3xl tracking-tight text-foreground sm:text-4xl">
                Honest help across role transitions and technical loops.
              </h2>
            </Reveal>

            <div
              className="flex flex-wrap gap-2"
              role="tablist"
              aria-label="Candidate personas"
            >
              {personas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={personaId === p.id}
                  onClick={() => setPersonaId(p.id)}
                  className={cn(
                    "min-h-10 rounded-full border px-4 py-1.5 text-sm transition-colors",
                    personaId === p.id
                      ? "border-ink bg-ink font-medium text-ink-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activePersona.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.26, ease: EASE }}
              className="mt-8 grid overflow-hidden rounded-2xl border bg-background lg:grid-cols-[1.05fr_1fr]"
            >
              {/* Fixed aspect ratio / height so all 3 persona images align identically */}
              <div className="aspect-[4/3] w-full overflow-hidden bg-muted lg:aspect-auto lg:h-[380px]">
                <img
                  src={activePersona.image}
                  alt={activePersona.alt}
                  loading="eager"
                  decoding="async"
                  className="h-full w-full object-cover object-center"
                />
              </div>

              <div className="flex flex-col justify-between p-6 sm:p-9 lg:h-[380px]">
                <div>
                  <p className="eyebrow">{activePersona.role}</p>
                  <h3 className="font-display mt-2 text-2xl tracking-tight text-foreground">
                    {activePersona.label}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {activePersona.need}
                  </p>
                </div>

                <div className="mt-6 rounded-xl border bg-card p-4">
                  <p className="eyebrow mb-1.5">Example live cue</p>
                  <p className="text-sm font-medium text-foreground">
                    {activePersona.example.prompt}
                  </p>
                  <p className="mt-2 border-l-2 border-primary pl-3 text-sm text-muted-foreground">
                    {activePersona.example.cue}
                  </p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {/* Dark Pine Privacy & Explicit Capture Section */}
      <section
        id="privacy"
        className="grain relative overflow-hidden bg-pine py-16 text-pine-foreground lg:py-24"
      >
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:gap-12">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-pine-foreground/70">
              Privacy & explicit capture
            </p>
            <h2 className="font-display mt-3 text-3xl leading-tight tracking-tight text-white sm:text-4xl">
              Control stays visible in your hands, never hidden in the background.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-pine-foreground/80">
              Vren AI separates tab audio from your microphone, discloses every capture path before
              streaming begins, and keeps raw audio off disk by default.
            </p>
            <div className="mt-7 aspect-[16/9] w-full overflow-hidden rounded-xl border border-white/12 bg-ink/40">
              <img
                src="/images/workspace.jpg"
                alt="Minimal sunlit office desk with a laptop beside tall windows"
                loading="eager"
                decoding="async"
                className="h-full w-full object-cover object-center opacity-90"
              />
            </div>
          </Reveal>

          <Stagger inView className="grid gap-4 sm:grid-cols-2">
            {[
              {
                icon: SpeakerHighIcon,
                title: "Tab audio vs. microphone",
                body: "Chrome tab capture and your mic are separate switches with separate permission prompts.",
              },
              {
                icon: LockKeyIcon,
                title: "No raw audio stored",
                body: "Audio streams only during an active session for transcription and is discarded immediately.",
              },
              {
                icon: MicrophoneIcon,
                title: "Opt-in transcript retention",
                body: "Transcripts stay off unless you turn them on in prep or workspace defaults.",
              },
              {
                icon: ShieldCheckIcon,
                title: "Clear product boundaries",
                body: "No hidden overlay evasion, no candidate impersonation, and no automated speaking.",
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <StaggerItem key={card.title}>
                  <div className="h-full rounded-xl border border-white/12 bg-white/5 p-5 backdrop-blur-xs">
                    <Icon className="size-5 text-[#7ad4c4]" aria-hidden="true" />
                    <h3 className="mt-3 text-sm font-semibold text-white">{card.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-pine-foreground/75">
                      {card.body}
                    </p>
                  </div>
                </StaggerItem>
              );
            })}
          </Stagger>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-b py-16 lg:py-20">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <Reveal>
            <p className="eyebrow mb-3">Ready when your next interview is</p>
            <h2 className="font-display text-3xl tracking-tight sm:text-4xl">
              Bring your CV. Check the gaps. Walk into the call composed.
            </h2>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" asChild>
                <Link to="/auth" search={{ mode: "signup" }}>
                  Create your workspace <ArrowRightIcon className="size-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/auth" search={{ mode: "signin" }}>
                  Try demo workspace
                </Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 sm:flex-row sm:items-center sm:px-6">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <Logo />
            <span className="font-mono text-xs text-muted-foreground">
              Coaching, not a hiring assessment.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
            <PrivacyDialog
              trigger={
                <button type="button" className="min-h-9 hover:text-foreground hover:underline">
                  Privacy commitments
                </button>
              }
            />
            <TermsDialog
              trigger={
                <button type="button" className="min-h-9 hover:text-foreground hover:underline">
                  Terms & boundaries
                </button>
              }
            />
            <span className="font-mono">© 2026 Vren AI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
