import { Link } from "@tanstack/react-router";
import { CheckCircleIcon, WarningCircleIcon, SparkleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { FieldOrigin } from "@/lib/store";

export function Logo({
  className,
  inverted = false,
}: {
  className?: string;
  inverted?: boolean;
}) {
  return (
    <Link
      to="/"
      className={cn(
        "inline-flex items-center gap-2.5 font-semibold tracking-tight transition-opacity hover:opacity-85",
        inverted ? "text-ink-foreground" : "text-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "grid size-7 place-items-center rounded-lg border shadow-xs",
          inverted
            ? "border-white/15 bg-white/10 text-white"
            : "border-ink/10 bg-ink text-ink-foreground",
        )}
        aria-hidden="true"
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="none">
          <path
            d="M4.2 5.2L10 15.6L15.8 5.2"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="5.5" r="1.4" fill="#a8522f" />
        </svg>
      </span>
      <span className="text-[15px] tracking-tight">Vren AI</span>
    </Link>
  );
}

const tones = {
  success: "text-success border-success/25 bg-success/8",
  warning: "text-warning border-warning/30 bg-warning/8",
  error: "text-destructive border-destructive/25 bg-destructive/8",
  neutral: "text-muted-foreground border-border bg-muted/80",
  brand: "text-primary border-primary/25 bg-primary-soft/70",
  copper: "text-copper border-copper/25 bg-copper-soft/70",
};

export function Status({
  tone = "neutral",
  pulse = false,
  className,
  children,
}: {
  tone?: keyof typeof tones | undefined;
  pulse?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      <span className="relative flex size-1.5" aria-hidden="true">
        {pulse && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-65" />
        )}
        <span className="relative inline-flex size-1.5 rounded-full bg-current" />
      </span>
      {children}
    </span>
  );
}

export function OriginBadge({
  origin,
  confidence,
}: {
  origin: FieldOrigin;
  confidence?: number | undefined;
}) {
  if (origin === "verified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/8 px-2.5 py-0.5 font-mono text-[11px] font-medium text-success whitespace-nowrap">
        <CheckCircleIcon className="size-3.5" weight="fill" aria-hidden="true" />
        Verified by you
      </span>
    );
  }
  if (origin === "missing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/8 px-2.5 py-0.5 font-mono text-[11px] font-medium text-warning whitespace-nowrap">
        <WarningCircleIcon className="size-3.5" weight="fill" aria-hidden="true" />
        Missing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/80 px-2.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground whitespace-nowrap">
      <SparkleIcon className="size-3" aria-hidden="true" />
      Extracted{confidence ? ` · ${Math.round(confidence * 100)}%` : ""}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="font-display text-3xl tracking-tight text-foreground md:text-[2.125rem] md:leading-[1.12]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong bg-card/60 p-8 text-center">
      {icon && (
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-lg border bg-background text-muted-foreground">
          {icon}
        </div>
      )}
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2.5 text-sm">{children}</div>}
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    pct >= 85 ? "bg-success" : pct >= 60 ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2" aria-label={`Extraction confidence ${pct}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] text-muted-foreground tabular">{pct}%</span>
    </div>
  );
}
