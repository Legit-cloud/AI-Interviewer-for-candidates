import { IconContext } from "@phosphor-icons/react/dist/lib/context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { NavigationProgress } from "@/components/loading";
import { Logo } from "@/components/vren";

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12">
      <div className="mb-10">
        <Logo />
      </div>
      <div className="panel max-w-md p-8 text-center">
        <p className="eyebrow">404 · Route missing</p>
        <h1 className="font-display mt-3 text-4xl tracking-tight text-foreground">
          This page doesn’t exist.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The link may have moved or expired. Head back to the workspace to keep preparing.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/"
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Back to home
          </Link>
          <Link
            to="/app"
            className="inline-flex h-9 items-center justify-center rounded-md border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Open dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12">
      <div className="mb-10">
        <Logo />
      </div>
      <div className="panel max-w-md p-8 text-center">
        <p className="eyebrow text-destructive">Unexpected error</p>
        <h1 className="font-display mt-3 text-3xl tracking-tight text-foreground">
          This view didn’t finish loading.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your saved profile and session notes stay intact locally. Try reloading this view or return home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-md border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "theme-color", content: "#f5f3ee" },
      { title: "Vren AI | Calm, honest interview guidance" },
      {
        name: "description",
        content:
          "Prepare with your own CV and job context, then get concise, evidence-based interview guidance.",
      },
      { property: "og:title", content: "Vren AI" },
      { property: "og:description", content: "Concise interview guidance grounded in your real experience." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&family=Geist:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <IconContext.Provider value={{ weight: "regular" }}>
          <NavigationProgress />
          <Outlet />
          <Toaster position="bottom-right" />
        </IconContext.Provider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
