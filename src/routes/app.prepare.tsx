import { createFileRoute, redirect } from "@tanstack/react-router";

// Preparing and going live are one step now. This route only keeps old links and bookmarks working.
export const Route = createFileRoute("/app/prepare")({
  validateSearch: (s: Record<string, unknown>): { job?: string | undefined } => ({
    job: typeof s["job"] === "string" ? (s["job"] as string) : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/app/live", search: { job: search.job } });
  },
});
