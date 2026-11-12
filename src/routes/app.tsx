import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { BriefcaseIcon } from "@phosphor-icons/react/Briefcase";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { BroadcastIcon } from "@phosphor-icons/react/Broadcast";
import { GearIcon } from "@phosphor-icons/react/Gear";
import { PlayCircleIcon } from "@phosphor-icons/react/PlayCircle";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { SignOutIcon } from "@phosphor-icons/react/SignOut";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { UserIcon } from "@phosphor-icons/react/User";
import { Button } from "@/components/ui/button";
import { WorkspaceLoadingShell } from "@/components/loading";
import { motion } from "@/components/motion";
import { Logo } from "@/components/vren";
import { hasAuthSession } from "@/lib/api";
import { auth, getState, hydrateFromBackend, useAppState } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: async () => {
    // A refresh or deep link starts with an empty store. If tokens exist, load the account before guarding.
    if (!getState().user && hasAuthSession()) await hydrateFromBackend();
    const { user } = getState();
    if (!user) throw redirect({ to: "/auth", search: { mode: "signin" } });
    if (!user.verified) throw redirect({ to: "/auth", search: { mode: "verify" } });
    if (!user.onboarded) throw redirect({ to: "/onboarding" });
  },
  component: AppLayout,
  pendingComponent: WorkspaceLoadingShell,
});

const nav = [
  { to: "/app", label: "Dashboard", icon: SquaresFourIcon, exact: true },
  { to: "/app/profile", label: "Profile", icon: UserIcon },
  { to: "/app/jobs", label: "Jobs", icon: BriefcaseIcon },
  { to: "/app/prepare", label: "Prepare", icon: PlayCircleIcon },
  { to: "/app/live", label: "Live", icon: BroadcastIcon },
  { to: "/app/sessions", label: "Sessions", icon: ClockCounterClockwiseIcon },
  { to: "/app/settings", label: "Settings", icon: GearIcon },
] as const;

function AppLayout() {
  const { user, profile } = useAppState();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const handleSignOut = () => {
    auth.signOut();
    navigate({ to: "/auth", search: { mode: "signin" }, replace: true });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <aside className="sticky top-0 z-30 flex shrink-0 flex-col border-b bg-sidebar/95 backdrop-blur-md md:h-dvh md:w-64 md:border-r md:border-b-0 md:bg-sidebar">
        <div className="flex h-14 items-center justify-between px-4 md:h-16 md:px-5">
          <Logo />
          <div className="flex items-center gap-1.5 md:hidden">
            <Button size="sm" variant="outline" asChild className="h-9 px-2.5 text-xs">
              <Link to="/app/prepare">
                <PlusIcon className="size-3.5" aria-hidden="true" />
                Prepare
              </Link>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Sign out"
              onClick={handleSignOut}
              className="h-9 w-9"
            >
              <SignOutIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="hidden px-4 pb-4 md:block">
          <Button className="w-full justify-start" size="sm" asChild>
            <Link to="/app/prepare">
              <PlayCircleIcon className="size-4" aria-hidden="true" />
              Prepare interview
            </Link>
          </Button>
        </div>

        <nav
          aria-label="Workspace"
          className="scrollbar-none flex gap-1 overflow-x-auto px-3 pb-2.5 md:flex-col md:overflow-visible md:pb-0"
        >
          {nav.map(({ to, label, icon: Icon, ...rest }) => {
            const isActive =
              "exact" in rest ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
            return (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: "exact" in rest }}
                className={cn(
                  "relative flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors md:min-h-0 md:gap-2.5",
                  isActive
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="app-nav-pill"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-lg border bg-card shadow-xs"
                  />
                )}
                <Icon
                  className={cn("relative z-10 size-4 shrink-0", isActive && "text-primary")}
                  weight={isActive ? "fill" : "regular"}
                  aria-hidden="true"
                />
                <span className="relative z-10">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden space-y-3 border-t p-4 md:block">
          <div className="text-sm">
            <p className="truncate font-medium text-foreground">{profile?.name || "Candidate"}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <SignOutIcon className="size-3.5" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 md:px-10 md:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
