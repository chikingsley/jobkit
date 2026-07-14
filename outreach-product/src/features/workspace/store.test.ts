import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./store";

const initialState = useWorkspaceStore.getInitialState();

describe("workspace store", () => {
  beforeEach(() => useWorkspaceStore.setState(initialState, true));

  it("keeps transient job controls together", () => {
    const state = useWorkspaceStore.getState();

    state.setCountryFilter("Japan");
    state.setFitFilter("Strong match");
    state.setSelectedJobId("job-1");
    state.setShowExcluded(true);

    expect(useWorkspaceStore.getState()).toMatchObject({
      countryFilter: "Japan",
      fitFilter: "Strong match",
      selectedJobId: "job-1",
      showExcluded: true,
    });
  });
});
