import { create } from "zustand";

interface WorkspaceState {
  countryFilter: string;
  fitFilter: string;
  selectedJobId: string;
  setCountryFilter: (countryFilter: string) => void;
  setFitFilter: (fitFilter: string) => void;
  setSelectedJobId: (selectedJobId: string) => void;
  setShowExcluded: (showExcluded: boolean) => void;
  showExcluded: boolean;
}

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  countryFilter: "all",
  fitFilter: "all",
  selectedJobId: "",
  setCountryFilter: (countryFilter) => set({ countryFilter }),
  setFitFilter: (fitFilter) => set({ fitFilter }),
  setSelectedJobId: (selectedJobId) => set({ selectedJobId }),
  setShowExcluded: (showExcluded) => set({ showExcluded }),
  showExcluded: false,
}));
