export const workspacePaths = {
  automation: "/app/settings/automation",
  campaigns: "/app/campaigns",
  countries: "/app/campaigns/markets",
  documents: "/app/settings/documents",
  jobs: "/app/jobs",
  messageStyle: "/app/settings/writing-style",
  messages: "/app/messages",
  operator: "/app/operator",
  preferences: "/app/settings/preferences",
  profile: "/app/settings/profile",
  settings: "/app/settings",
  testLab: "/app/operator/test-lab",
} as const;

export type WorkspaceView = keyof typeof workspacePaths;

const TRAILING_SLASH_PATTERN = /\/+$/u;

const workspaceViewsByPath = new Map<string, WorkspaceView>(
  Object.entries(workspacePaths).map(([view, path]) => [
    path,
    view as WorkspaceView,
  ])
);

export function workspaceViewFromPathname(pathname: string): WorkspaceView {
  const normalizedPathname =
    pathname.replace(TRAILING_SLASH_PATTERN, "") || "/";
  if (normalizedPathname.startsWith(`${workspacePaths.countries}/`)) {
    return "countries";
  }
  if (normalizedPathname.startsWith(`${workspacePaths.campaigns}/`)) {
    return "campaigns";
  }
  return workspaceViewsByPath.get(normalizedPathname) ?? "jobs";
}
