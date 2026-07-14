import { create } from "zustand";

export type WorkspaceView = "documents" | "jobs" | "preferences" | "profile";

interface WorkspaceState {
  activeView: WorkspaceView;
  countryFilter: string;
  fitFilter: string;
  selectedJobId: string;
  setActiveView: (activeView: WorkspaceView) => void;
  setCountryFilter: (countryFilter: string) => void;
  setFitFilter: (fitFilter: string) => void;
  setSelectedJobId: (selectedJobId: string) => void;
  setShowExcluded: (showExcluded: boolean) => void;
  showExcluded: boolean;
}

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  activeView: "jobs",
  countryFilter: "all",
  fitFilter: "all",
  selectedJobId: "",
  setActiveView: (activeView) => set({ activeView }),
  setCountryFilter: (countryFilter) => set({ countryFilter }),
  setFitFilter: (fitFilter) => set({ fitFilter }),
  setSelectedJobId: (selectedJobId) => set({ selectedJobId }),
  setShowExcluded: (showExcluded) => set({ showExcluded }),
  showExcluded: false,
}));
