import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { legacyWorkspaceDestination } from "@/features/workspace/legacy-routes";

export const Route = createFileRoute("/$")({
  beforeLoad: ({ location }) => {
    const destination = legacyWorkspaceDestination(location.pathname);
    if (destination) {
      throw redirect({
        href: `${destination}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
        statusCode: 308,
      });
    }
    throw notFound();
  },
});
