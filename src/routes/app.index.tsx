import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { BriefcaseIcon } from "@phosphor-icons/react/Briefcase";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { CircleIcon } from "@phosphor-icons/react/Circle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { XIcon } from "@phosphor-icons/react/X";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { DashboardSkeleton } from "@/components/loading";
import { PageTransition, Stagger, StaggerItem } from "@/components/motion";
import { EmptyState, PageHeader, Status } from "@/components/vren";
import {
  dismissChecklist,
  jobCompleteness,
  profileCompleteness,
  unverifiedCount,
  useAppState,
} from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Dashboard | Vren AI" },
      { name: "description", content: "Your profile, jobs, and recent sessions." },
      { property: "og:title", content: "Dashboard | Vren AI" },
      { property: "og:description", content: "Your interview workspace overview." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
  pendingComponent: DashboardSkeleton,
});

function Dashboard() {
  const { profile, jobs, sessions, checklistDismissed } = useAppState();
  const activeJobs = jobs.filter((j) => !j.archived);
  const pct = profileCompleteness(profile);
  const unverified = unverifiedCount(profile);
  const hasContent = (profile?.experience.length ?? 0) > 0 || activeJobs.length > 0;

  const checklist = [
    {
      done: (profile?.documents.length ?? 0) > 0 || (profile?.experience.length ?? 0) > 0,
      label: "Add your CV or experience",
      to: "/app/profile" as const,
      cta: "Open profile",
    },
    {
      done: (profile?.experience.length ?? 0) > 0 && unverified === 0,
      label: "Verify extracted profile fields",
      to: "/app/profile/review" as const,
      cta: "Open CV review",
    },
    {
      done: activeJobs.length > 0,
      label: "Add a target job description",
      to: "/app/jobs" as const,
      cta: "Add job",
    },
  ];
  const remainingSteps = checklist.filter((c) => !c.done).length;

  return (
    <PageTransition className="space-y-9">
      <PageHeader
        eyebrow={format(new Date(), "EEEE, d MMMM")}
        title={`Good to see you, ${profile?.name.split(" ")[0] || "there"}`}
        description="Review your verified context, check job gaps, and configure preparation before opening the live companion."
        actions={
          <Button asChild>
            <Link to="/app/prepare">
              Prepare an interview
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      {!hasContent && (
        <EmptyState
          icon={<FileTextIcon className="size-5" aria-hidden="true" />}
          title="Add a CV or create a job description to prepare your first session."
          description="Your profile stays private and reusable across every application."
        >
          <Button size="sm" variant="outline" asChild>
            <Link to="/app/profile">Add a CV</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/app/jobs">Add a job</Link>
          </Button>
        </EmptyState>
      )}

      {!checklistDismissed && remainingSteps > 0 && (
        <section className="panel p-5" aria-label="Workspace setup checklist">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Setup checklist · {remainingSteps} remaining</p>
              <p className="mt-0.5 text-sm font-medium text-foreground">
                Finish setting up your interview context
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Dismiss setup checklist"
              onClick={dismissChecklist}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {checklist.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-sm transition-colors",
                    item.done
                      ? "bg-muted/40 text-muted-foreground"
                      : "bg-background hover:border-border-strong hover:bg-muted/40",
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    {item.done ? (
                      <CheckCircleIcon
                        className="size-4 shrink-0 text-success"
                        weight="fill"
                        aria-hidden="true"
                      />
                    ) : (
                      <CircleIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className={item.done ? "line-through" : "font-medium"}>{item.label}</span>
                  </span>
                  {!item.done && (
                    <span className="font-mono text-[11px] text-primary">{item.cta} →</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Core Workspace Status Trio (no decorative metrics per PRD §10.3) */}
      <Stagger className="grid gap-4 md:grid-cols-3">
        <StaggerItem>
          <div className="panel flex h-full flex-col justify-between p-5">
            <div>
              <p className="eyebrow">Active profile</p>
              <p className="mt-2 font-semibold text-foreground">{profile?.name}</p>
              <p className="text-sm text-muted-foreground">
                {profile?.headline || "No headline added yet"}
              </p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1.5 font-mono text-xs text-muted-foreground tabular">
                {pct}% context complete
              </p>
            </div>
            <Link
              to="/app/profile"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Review profile
              <ArrowRightIcon className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </StaggerItem>

        <StaggerItem>
          <div className="panel flex h-full flex-col justify-between p-5">
            <div>
              <p className="eyebrow">Next step</p>
              {unverified > 0 ? (
                <>
                  <p className="mt-2 font-semibold text-foreground">
                    Verify {unverified} extracted {unverified === 1 ? "field" : "fields"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Only verified context is cited with confidence during live guidance.
                  </p>
                </>
              ) : activeJobs.length === 0 ? (
                <>
                  <p className="mt-2 font-semibold text-foreground">Add a job description</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Compare requirements against your verified profile to surface gaps early.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 font-semibold text-foreground">Run a preparation</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Snapshot your interview format, framework, and retention choice.
                  </p>
                </>
              )}
            </div>
            {unverified > 0 ? (
              <Link
                to="/app/profile/review"
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Open CV review
                <ArrowRightIcon className="size-3.5" aria-hidden="true" />
              </Link>
            ) : activeJobs.length === 0 ? (
              <Link
                to="/app/jobs"
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Add a job
                <ArrowRightIcon className="size-3.5" aria-hidden="true" />
              </Link>
            ) : (
              <Link
                to="/app/prepare"
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Prepare now
                <ArrowRightIcon className="size-3.5" aria-hidden="true" />
              </Link>
            )}
          </div>
        </StaggerItem>
      </Stagger>

      {/* Recent Jobs */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold tracking-tight">Recent jobs</h2>
          <Link to="/app/jobs" className="text-sm text-primary hover:underline">
            All jobs ({activeJobs.length})
          </Link>
        </div>
        {activeJobs.length === 0 ? (
          <EmptyState
            icon={<BriefcaseIcon className="size-5" aria-hidden="true" />}
            title="No active jobs yet"
            description="Add a job description to compare requirements against your profile."
          >
            <Button size="sm" variant="outline" asChild>
              <Link to="/app/jobs">Create job</Link>
            </Button>
          </EmptyState>
        ) : (
          <ul className="panel divide-y overflow-hidden">
            {activeJobs.slice(0, 4).map((j) => {
              const comp = jobCompleteness(j);
              return (
                <li key={j.id}>
                  <Link
                    to="/app/jobs/$jobId"
                    params={{ jobId: j.id }}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-foreground">{j.title}</span>
                      <span className="text-muted-foreground"> · {j.company}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Status tone={comp >= 75 ? "success" : "warning"}>
                        {comp >= 75 ? "Context ready" : "Needs detail"}
                      </Status>
                      <span className="font-mono text-xs text-muted-foreground tabular">
                        {format(new Date(j.updatedAt), "d MMM")}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent Sessions */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold tracking-tight">Recent sessions</h2>
          <Link to="/app/sessions" className="text-sm text-primary hover:underline">
            Session history
          </Link>
        </div>
        {sessions.length === 0 ? (
          <EmptyState
            icon={<ClockCounterClockwiseIcon className="size-5" aria-hidden="true" />}
            title="No sessions yet"
            description="Your completed and interrupted interview sessions will appear here for review."
          />
        ) : (
          <ul className="panel divide-y overflow-hidden">
            {sessions.slice(0, 3).map((s) => (
              <li key={s.id}>
                <Link
                  to="/app/sessions/$sessionId"
                  params={{ sessionId: s.id }}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50"
                >
                  <div className="text-sm">
                    <span className="font-medium text-foreground">
                      {jobs.find((j) => j.id === s.jobId)?.title ?? "Untitled role"}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground tabular">
                      {" "}
                      · {s.durationMin} min · {s.questions.length} questions
                    </span>
                  </div>
                  {s.state === "completed" ? (
                    <Status tone="success">Completed</Status>
                  ) : (
                    <Status tone="warning">Interrupted · review available</Status>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageTransition>
  );
}
