import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Upload, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/vren";
import { completeOnboarding, getState, setState } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  beforeLoad: () => {
    if (!getState().user) throw redirect({ to: "/auth", search: { mode: "signin" } });
  },
  head: () => ({
    meta: [
      { title: "Get started — Vren AI" },
      { name: "description", content: "Set up your Vren AI profile in three short steps." },
      { property: "og:title", content: "Get started — Vren AI" },
      { property: "og:description", content: "Profile basics, CV upload and extension connection." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Onboarding,
});

const steps = ["Profile basics", "Add a CV", "Connect extension"];

function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("English");
  const [roleFocus, setRoleFocus] = useState("");
  const [cv, setCv] = useState<File | null>(null);

  const finish = (connect: boolean) => {
    completeOnboarding(name || "Candidate", language, roleFocus, !!cv);
    if (connect) setState((s) => ({ ...s, extension: { connected: true, version: "1.0.0", connectedAt: new Date().toISOString() } }));
    navigate({ to: "/app" });
  };

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Logo />
          <span className="font-mono text-xs text-muted-foreground">Step {step + 1} of 3</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <ol className="mb-10 grid grid-cols-3 gap-2">
          {steps.map((s, i) => (
            <li key={s} className="space-y-2">
              <div className={cn("h-1 rounded-full", i <= step ? "bg-primary" : "bg-border")} />
              <p className={cn("flex items-center gap-1.5 text-xs", i === step ? "font-medium" : "text-muted-foreground")}>
                {i < step && <Check className="size-3 text-success" />} {s}
              </p>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="space-y-6">
            <h1 className="text-2xl font-bold tracking-tight">Tell us a little about you</h1>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lang">Preferred language</Label>
                <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)} className="h-9 w-full rounded-md border bg-card px-3 text-sm">
                  <option>English</option>
                </select>
                <p className="text-xs text-muted-foreground">More languages after quality evaluation.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="focus">Role focus (optional)</Label>
                <Input id="focus" placeholder="e.g. Product design" value={roleFocus} onChange={(e) => setRoleFocus(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(1)} disabled={!name.trim()}>Continue</Button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-6">
            <h1 className="text-2xl font-bold tracking-tight">Add your CV</h1>
            <p className="text-sm text-muted-foreground">PDF or DOCX, up to 5 MB and 10 pages. You'll review every extracted field before it's used.</p>
            <label className="panel flex cursor-pointer flex-col items-center gap-3 border-dashed p-10 text-center hover:bg-muted">
              <Upload className="size-6 text-primary" />
              <span className="text-sm font-medium">{cv ? cv.name : "Choose a file"}</span>
              <span className="text-xs text-muted-foreground">Stored privately. Only you can access it.</span>
              <input type="file" accept=".pdf,.docx" className="sr-only" onChange={(e) => setCv(e.target.files?.[0] ?? null)} />
            </label>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>Continue without a CV</Button>
              <Button onClick={() => setStep(2)} disabled={!cv}>Add a CV</Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-6">
            <h1 className="text-2xl font-bold tracking-tight">Connect the Chrome extension</h1>
            <div className="panel flex gap-4 p-5">
              <Puzzle className="size-5 shrink-0 text-primary" />
              <div className="text-sm">
                <p className="font-medium">Install Vren AI from the Chrome Web Store, open it, then choose "Connect to Vren AI".</p>
                <p className="mt-1 text-muted-foreground">We record the connection time and version — never your browsing history.</p>
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => finish(false)}>Skip for now</Button>
              <Button onClick={() => finish(true)}>Connect extension</Button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
