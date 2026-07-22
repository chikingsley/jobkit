import { createContext, useContext } from "react";
import type { useWorkspaceData } from "@/features/workspace/use-workspace-data";

export type WorkspaceData = ReturnType<typeof useWorkspaceData>;

export const WorkspaceDataContext = createContext<WorkspaceData | null>(null);

export function useWorkspaceContext(): WorkspaceData {
  const value = useContext(WorkspaceDataContext);
  if (!value) {
    throw new Error(
      "useWorkspaceContext must be used inside the app workspace"
    );
  }
  return value;
}
