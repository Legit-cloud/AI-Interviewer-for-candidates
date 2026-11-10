import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, UserRound, Briefcase, PlayCircle, History, Settings, LogOut } from "lucide-react";
import { Logo, Status } from "@/components/vren";
import { auth, getState, useAppState } from "@/lib/store";

export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: () => {
    const { user } = getState();
    if (!user) throw redirect({ to: "/auth", search: { mode: "signin" } });
    if (!user.verified) throw redirect({ to: "/auth", search: { mode: "verify" } });
    if (!user.onboarded) throw redirect({ to: "/onboarding" });
  },
  component: AppLayout,
});

const nav = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/app/profile", label: "Profile", icon: UserRound },
  { to: "/app/jobs", label: "Jobs", icon: Briefcase },
  { to: "/app/prepare", label: "Prepare", icon: PlayCircle },
  { to: "/app/sessions", label: "Sessions", icon: History },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const;

function AppLayout() {
  const { user, profile, extension } = useAppState();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b bg-sidebar md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
        <div className="flex h-16 items-center px-5">
          <Logo />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {nav.map(({ to, label, icon: Icon, ...rest }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: "exact" in rest }}
              className="flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-foreground"
            >
              <Icon className="size-4" /> {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden space-y-3 border-t p-4 md:block">
          <Status tone={extension.connected ? "success" : "neutral"}>{extension.connected ? "Extension connected" : "Extension not connected"}</Status>
          <div className="text-sm">
            <p className="truncate font-medium">{profile?.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <button
            onClick={() => {
              auth.signOut();
              navigate({ to: "/auth", search: { mode: "signin" }, replace: true });
            }}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
