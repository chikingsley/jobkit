import { createFileRoute } from "@tanstack/react-router";
import { AuthenticatedApp } from "@/authenticated-app";
import { AuthGate } from "@/features/auth/auth-gate";

export const Route = createFileRoute("/app")({
  component: PrivateAppRoute,
  head: () => ({
    meta: [
      { title: "JobKit workspace" },
      { content: "noindex,nofollow", name: "robots" },
    ],
  }),
});

function PrivateAppRoute() {
  return (
    <AuthGate>
      <AuthenticatedApp />
    </AuthGate>
  );
}
