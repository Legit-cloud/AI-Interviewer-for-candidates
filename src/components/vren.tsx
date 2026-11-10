import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import type { FieldOrigin } from "@/lib/store";

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="grid size-7 place-items-center rounded-md bg-ink font-mono text-sm text-ink-foreground">V</span>
      <span>Vren AI</span>
    </Link>
  );
}

const tones = {
  success: "text-success border-success/30 bg-success/5",
  warning: "text-warning border-warning/30 bg-warning/5",
  error: "text-destructive border-destructive/30 bg-destructive/5",
  neutral: "text-muted-foreground border-border bg-muted",
  brand: "text-primary border-primary/30 bg-primary/5",
};

export function Status({ tone = "neutral", children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] font-medium", tones[tone])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

export function OriginBadge({ origin, confidence }: { origin: FieldOrigin; confidence?: number | undefined }) {
  if (origin === "verified") return <Status tone="success">Verified by you</Status>;
  if (origin === "missing") return <Status tone="warning">Missing</Status>;
  return <Status tone="neutral">Extracted{confidence ? ` · ${Math.round(confidence * 100)}%` : ""}</Status>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">{title}</p>
      <div className="mt-3 flex justify-center gap-2 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
