import { useState } from "react";
import { toast } from "sonner";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImportReview } from "@/features/onboarding/import-review";
import { ResumeUploadStep } from "@/features/onboarding/resume-upload-step";
import type {
  OnboardingState,
  ProfileImportProposal,
  ProfileImportResult,
} from "@/features/onboarding/schema";
import { apiRequest } from "@/lib/api";
import { PreferencesView } from "@/views/preferences-view";
import { ProfileView } from "@/views/profile-view";

type OnboardingStep = "resume" | "profile" | "preferences" | "finish";

export function OnboardingPage({
  onComplete,
  state,
}: {
  onComplete: (completedAt: string) => void;
  state: OnboardingState;
}) {
  const [profile, setProfile] = useState(state.profile);
  const [preferences, setPreferences] = useState(state.preferences);
  const [proposal, setProposal] = useState<ProfileImportProposal | null>(
    state.profileImport?.proposal ?? null
  );
  const [step, setStep] = useState<OnboardingStep>(() => initialStep(state));
  const [completing, setCompleting] = useState(false);

  function imported(result: ProfileImportResult) {
    setProfile(result.profile);
    setProposal(result.proposal);
    setStep("profile");
  }

  async function complete() {
    setCompleting(true);
    try {
      const response = await apiRequest("/api/onboarding/complete", {
        method: "POST",
      });
      const result = (await response.json()) as { completedAt: string };
      toast.success("Your workspace is ready");
      onComplete(result.completedAt);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Onboarding could not finish"
      );
      setStep("finish");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <main className="min-h-svh bg-background">
      <header className="flex h-14 items-center border-b px-4 sm:px-6">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground text-sm">
            J
          </span>
          JobKit
        </div>
        <div className="ml-auto">
          <ModeToggle />
        </div>
      </header>
      <OnboardingSteps step={step} />
      {step === "resume" ? (
        <ResumeUploadStep
          onImported={imported}
          onManual={() => setStep("profile")}
        />
      ) : null}
      {step === "profile" ? (
        <>
          {proposal ? <ImportReview proposal={proposal} /> : null}
          <ProfileView
            onSaved={(next) => {
              setProfile(next);
              setStep("preferences");
            }}
            profile={profile}
            request={apiRequest}
          />
        </>
      ) : null}
      {step === "preferences" ? (
        <PreferencesView
          onSaved={(next) => {
            setPreferences(next);
            void complete();
          }}
          preferences={preferences}
          request={apiRequest}
        />
      ) : null}
      {step === "finish" ? (
        <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
          <Card>
            <CardHeader>
              <CardTitle>Finish setting up JobKit</CardTitle>
              <CardDescription>
                Your profile and preferences are saved. Finish to open your
                matched-job workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              You can change either section later without repeating onboarding.
            </CardContent>
            <CardFooter className="justify-end">
              <Button disabled={completing} onClick={() => void complete()}>
                {completing ? "Finishing…" : "Open my workspace"}
              </Button>
            </CardFooter>
          </Card>
        </div>
      ) : null}
    </main>
  );
}

function initialStep(state: OnboardingState): OnboardingStep {
  if (state.hasProfile && state.hasPreferences) {
    return "finish";
  }
  if (state.hasProfile) {
    return "preferences";
  }
  if (state.profileImport?.status === "ready") {
    return "profile";
  }
  return "resume";
}

function OnboardingSteps({ step }: { step: OnboardingStep }) {
  const current = {
    finish: 2,
    preferences: 2,
    profile: 1,
    resume: 0,
  }[step];
  return (
    <div className="border-b bg-muted/20 px-4 py-3 sm:px-6">
      <ol className="mx-auto flex max-w-xl items-center justify-center gap-2 text-xs sm:gap-4">
        {["Resume", "Profile", "Preferences"].map((label, index) => (
          <li
            className={
              index <= current
                ? "flex items-center gap-2 font-medium text-foreground"
                : "flex items-center gap-2 text-muted-foreground"
            }
            key={label}
          >
            <span
              className={
                index <= current
                  ? "grid size-6 place-items-center rounded-full bg-primary text-primary-foreground"
                  : "grid size-6 place-items-center rounded-full border bg-background"
              }
            >
              {index + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
