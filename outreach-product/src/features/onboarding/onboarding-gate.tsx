import {
  lazy,
  type PropsWithChildren,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import type { OnboardingState } from "@/features/onboarding/schema";
import { apiRequest } from "@/lib/api";

const OnboardingPage = lazy(async () => ({
  default: (await import("@/features/onboarding/onboarding-page"))
    .OnboardingPage,
}));

export function OnboardingGate({ children }: PropsWithChildren) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await apiRequest("/api/onboarding");
      setState((await response.json()) as OnboardingState);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Onboarding could not load"
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <main className="grid min-h-svh place-items-center p-6">
        <div className="grid max-w-sm gap-4 text-center">
          <div>
            <h1 className="font-semibold text-xl">JobKit could not load</h1>
            <p className="mt-1 text-muted-foreground text-sm">{error}</p>
          </div>
          <Button onClick={() => void load()}>Try again</Button>
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
      <OnboardingPage
        onComplete={(completedAt) =>
          setState((current) =>
            current ? { ...current, completedAt } : current
          )
        }
        state={state}
      />
    </Suspense>
  );
}
