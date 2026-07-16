export const workspacePaths = {
  automation: "/automation",
  countries: "/countries",
  documents: "/documents",
  jobs: "/",
  messageStyle: "/message-style",
  preferences: "/preferences",
  profile: "/profile",
} as const;

export type WorkspaceView = keyof typeof workspacePaths;

const workspaceViewsByPath = new Map<string, WorkspaceView>(
  Object.entries(workspacePaths).map(([view, path]) => [
    path,
    view as WorkspaceView,
  ])
);

export function workspaceViewFromPathname(pathname: string): WorkspaceView {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  if (normalizedPathname.startsWith(`${workspacePaths.countries}/`)) {
    return "countries";
  }
  return workspaceViewsByPath.get(normalizedPathname) ?? "jobs";
}
