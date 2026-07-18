import { formatDescription } from "./content";
import type { ApplicationRoute } from "./types";

const PROTECTED_EMAIL = "[email protected]";

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
  const parts = formatted.split(PROTECTED_EMAIL);
  if (!route || parts.length === 1) {
    return (
      <p className="mt-4 whitespace-pre-line text-muted-foreground leading-7">
        {formatted || "No description was imported."}
      </p>
    );
  }
  let offset = 0;
  const keyedParts = parts.map((part) => {
    const start = offset;
    offset += part.length + PROTECTED_EMAIL.length;
    return { key: `${start}:${part.slice(0, 24)}`, part, showEmail: start > 0 };
  });
  return (
    <p className="mt-4 whitespace-pre-line text-muted-foreground leading-7">
      {keyedParts.map(({ key, part, showEmail }) => (
        <span key={key}>
          {showEmail ? (
            <mark className="rounded bg-primary/15 px-1 font-medium text-foreground">
              {route.destination}
            </mark>
          ) : null}
          {part}
        </span>
      ))}
    </p>
  );
}
