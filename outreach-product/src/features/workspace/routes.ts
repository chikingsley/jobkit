export const workspacePaths = {
  automation: "/automation",
  countries: "/countries",
  documents: "/documents",
  jobs: "/",
  messageStyle: "/message-style",
  messages: "/messages",
  preferences: "/preferences",
  profile: "/profile",
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
  return workspaceViewsByPath.get(normalizedPathname) ?? "jobs";
}
