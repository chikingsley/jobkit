import { App } from "@/app";
import { OnboardingGate } from "@/features/onboarding/onboarding-gate";

export function AuthenticatedApp() {
  return (
    <OnboardingGate>
      <App />
    </OnboardingGate>
  );
}
