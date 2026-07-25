import { lazy, type PropsWithChildren, Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  useMarkOnboardingComplete,
  useOnboardingGateState,
} from "@/features/onboarding/queries";

const OnboardingPage = lazy(async () => ({
  default: (await import("@/features/onboarding/onboarding-page"))
    .OnboardingPage,
}));

export function OnboardingGate({ children }: PropsWithChildren) {
  const stateQuery = useOnboardingGateState();
  const markComplete = useMarkOnboardingComplete();
  const state = stateQuery.data;

  if (stateQuery.isError) {
    return (
      <main className="grid min-h-svh place-items-center p-6">
        <div className="grid max-w-sm gap-4 text-center">
          <div>
            <h1 className="font-semibold text-xl">JobKit could not load</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {stateQuery.error.message || "Onboarding could not load"}
            </p>
          </div>
          <Button onClick={() => void stateQuery.refetch()}>Try again</Button>
        </div>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="grid min-h-svh place-items-center text-muted-foreground text-sm">
        Loading your workspace…
      </main>
    );
  }
  if (state.completedAt) {
    return children;
  }
  return (
    <Suspense
      fallback={
        <main className="grid min-h-svh place-items-center text-muted-foreground text-sm">
          Preparing onboarding…
        </main>
      }
    >
      <OnboardingPage onComplete={markComplete} state={state} />
    </Suspense>
  );
}
