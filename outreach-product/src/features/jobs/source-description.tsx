import { formatDescription } from "./content";
import { protectedEmailParts } from "./protected-email";
import type { ApplicationRoute } from "./types";

function singleActiveEmailRoute(routes: ApplicationRoute[]) {
  const emailRoutes = routes.filter(
    (route) => route.kind === "email" && route.status === "active"
  );
  return emailRoutes.length === 1 ? emailRoutes[0] : undefined;
}

export function SourceDescription({
  description,
  routes,
}: {
  description: string;
  routes: ApplicationRoute[];
}) {
  const formatted = formatDescription(description);
  const route = singleActiveEmailRoute(routes);
  const parts = protectedEmailParts(formatted);
  if (!(route && parts.some((part) => part.kind === "placeholder"))) {
    return (
      <p className="mt-4 whitespace-pre-line text-muted-foreground leading-7">
        {formatted || "No description was imported."}
      </p>
    );
  }
  return (
    <p className="mt-4 whitespace-pre-line text-muted-foreground leading-7">
      {parts.map((part) => (
        <span key={`${part.kind}:${part.offset}`}>
          {part.kind === "placeholder" ? (
            <mark className="rounded bg-primary/15 px-1 font-medium text-foreground">
              {route.destination}
            </mark>
          ) : (
            part.value
          )}
        </span>
      ))}
    </p>
  );
}
