const LEGACY_EXACT_ROUTES = new Map<string, string>([
  ["/automation", "/app/settings/automation"],
  ["/campaigns", "/app/campaigns"],
  ["/campaigns/markets", "/app/campaigns/markets"],
  ["/campaigns/new", "/app/campaigns/new"],
  ["/documents", "/app/settings/documents"],
  ["/message-style", "/app/settings/writing-style"],
  ["/messages", "/app/messages"],
  ["/operator", "/app/operator"],
  ["/preferences", "/app/settings/preferences"],
  ["/profile", "/app/settings/profile"],
  ["/settings", "/app/settings"],
  ["/test-lab", "/app/operator/test-lab"],
]);

const LEGACY_MARKET_ROUTE = /^\/campaigns\/markets\/([^/]+)$/u;
const LEGACY_CAMPAIGN_ROUTE = /^\/campaigns\/([^/]+)$/u;

function normalizedRouteSegment(segment: string): string | null {
  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch {
    return null;
  }
}

export function legacyWorkspaceDestination(pathname: string): string | null {
  const exact = LEGACY_EXACT_ROUTES.get(pathname);
  if (exact) {
    return exact;
  }
  const market = pathname.match(LEGACY_MARKET_ROUTE)?.[1];
  if (market) {
    const segment = normalizedRouteSegment(market);
    return segment ? `/app/campaigns/markets/${segment}` : null;
  }
  const campaign = pathname.match(LEGACY_CAMPAIGN_ROUTE)?.[1];
  if (campaign) {
    const segment = normalizedRouteSegment(campaign);
    return segment ? `/app/campaigns/${segment}` : null;
  }
  return null;
}
