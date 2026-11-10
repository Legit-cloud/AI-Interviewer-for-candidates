import { useRouterState } from "@tanstack/react-router";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { WifiSlashIcon } from "@phosphor-icons/react/WifiSlash";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatePresence, motion, EASE } from "@/components/motion";
import { Logo } from "@/components/vren";

/**
 * Tracks whether a pending state has lasted past `thresholdMs` (e.g. slow 3G/4G)
 * and whether the browser reports offline status.
 */
export function useNetworkStatus(active = true, thresholdMs = 4000) {
  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOffline(!navigator.onLine);
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), thresholdMs);
    return () => clearTimeout(timer);
  }, [active, thresholdMs]);

  return { slow, offline };
}

/**
 * Top slim progress indicator for slow route transitions + offline banner.
 * Mounted inside __root.tsx.
 */
export function NavigationProgress() {
  const isNavigating = useRouterState({
    select: (s) => s.isLoading || s.status === "pending",
  });
  const { slow, offline } = useNetworkStatus(isNavigating, 4000);

  return (
    <>
      <AnimatePresence>
        {isNavigating && (
          <motion.div
            key="nav-progress"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/15"
          >
            <motion.div
              className="h-full w-2/5 rounded-full bg-primary"
              initial={{ x: "-100%" }}
              animate={{ x: "260%" }}
              transition={{ duration: 1.15, ease: "easeInOut", repeat: Infinity }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(offline || slow) && (
          <motion.div
            key="network-banner"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-xs shadow-lg sm:left-auto"
          >
            <div className="flex items-center gap-2.5 text-foreground">
              <WifiSlashIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>
                {offline
                  ? "You appear to be offline. Local edits stay saved."
                  : "Taking longer than usual on a slow connection."}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2.5 text-xs"
              onClick={() => window.location.reload()}
            >
              <ArrowClockwiseIcon className="size-3.5" aria-hidden="true" />
              Reload
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Full-page loading skeleton for public routes (Landing, Auth, Onboarding)
 * when chunks or loaders take time over a slow network.
 */
export function PageLoadingShell({ label = "Loading workspace" }: { label?: string }) {
  const { slow, offline } = useNetworkStatus(true, 3800);

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="flex min-h-dvh flex-col bg-background"
    >
      <header className="border-b bg-background/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-20 rounded-md" />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        <div className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-36 rounded-full" />
            <Skeleton className="h-11 w-full max-w-lg rounded-lg" />
            <Skeleton className="h-5 w-full max-w-md rounded-md" />
          </div>

          <div className="grid gap-4 pt-4 md:grid-cols-3">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 font-mono text-xs text-muted-foreground">
            <span>
              {offline
                ? "Offline: waiting for network connection..."
                : slow
                  ? "Still loading on a slow connection..."
                  : `${label}...`}
            </span>
            {slow && (
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                <ArrowClockwiseIcon className="size-3.5" aria-hidden="true" />
                Retry
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Skeleton matching the /app workspace shell (sidebar + page content).
 */
export function WorkspaceLoadingShell() {
  const { slow } = useNetworkStatus(true, 3800);

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading workspace"
      className="flex min-h-dvh flex-col bg-background md:flex-row"
    >
      <aside className="flex shrink-0 flex-col border-b bg-sidebar md:h-dvh md:w-64 md:border-r md:border-b-0">
        <div className="flex h-14 items-center px-4 md:h-16 md:px-5">
          <Logo />
        </div>
        <div className="hidden space-y-2 px-4 py-2 md:block">
          <Skeleton className="mb-4 h-9 w-full rounded-md" />
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-8 md:px-10 md:py-10">
          <DashboardSkeleton />
          {slow && (
            <p className="font-mono text-xs text-muted-foreground">
              Still loading on a slow connection...
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

/** Header skeleton matching PageHeader rhythm. */
function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2.5">
        <Skeleton className="h-3.5 w-28 rounded-full" />
        <Skeleton className="h-9 w-64 max-w-full rounded-lg" />
        <Skeleton className="h-4 w-96 max-w-full rounded-md" />
      </div>
      <Skeleton className="h-10 w-40 rounded-md" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading dashboard" className="space-y-8">
      <HeaderSkeleton />
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="panel space-y-3 p-5">
            <Skeleton className="h-3.5 w-24 rounded-full" />
            <Skeleton className="h-5 w-40 rounded-md" />
            <Skeleton className="h-4 w-full rounded-md" />
            <Skeleton className="h-3 w-28 rounded-md" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-32 rounded-md" />
        <div className="panel divide-y">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between px-5 py-4">
              <Skeleton className="h-4 w-56 rounded-md" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading list" className="space-y-8">
      <HeaderSkeleton />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-48 rounded-lg" />
        <Skeleton className="h-10 w-64 max-w-full rounded-md" />
      </div>
      <div className="panel divide-y">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-48 rounded-md" />
              <Skeleton className="h-3 w-32 rounded-md" />
            </div>
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading details" className="space-y-8">
      <HeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="panel space-y-4 p-6">
          <Skeleton className="h-5 w-40 rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
        <div className="panel space-y-3 p-5">
          <Skeleton className="h-4 w-28 rounded-full" />
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="h-4 w-5/6 rounded-md" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

