import { describe, expect, it } from "vitest";
import { migratePreferencesV1 } from "../../../worker/repositories/user-settings";

describe("preferences schema migration", () => {
  it("repairs the lossy preschool value and fills the missing contract key", () => {
    const migrated = migratePreferencesV1({
      audiences: {
        adults: "prefer",
        college: "prefer",
        preschool: "exclude",
        primary: "accept",
        teenagers: "prefer",
      },
      benefits: {
        airfare: "prefer",
        healthInsurance: "prefer",
        housing: "prefer",
        paidLeave: "prefer",
        professionalDevelopment: "accept",
        visaSponsorship: "prefer",
      },
      countries: {
        acceptable: [],
        excluded: [],
        preferred: [],
      },
      employment: { fullTime: "prefer", partTime: "accept" },
      minimumMonthlyUsd: 0,
      requireVisaSponsorship: true,
      showUnknownHardConstraints: true,
      theme: "system",
    });

    expect(migrated.audiences.preschool).toBe("avoid");
    expect(migrated.employment.contract).toBe("accept");
    expect(migrated).not.toHaveProperty("theme");
  });
});
