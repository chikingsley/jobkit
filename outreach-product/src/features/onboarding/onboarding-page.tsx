import { useCallback, useState } from "react";
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
import { DocumentsView } from "@/features/documents/view";
import { ImportReview } from "@/features/onboarding/import-review";
import { ResumeUploadStep } from "@/features/onboarding/resume-upload-step";
import type {
  OnboardingState,
  ProfileImportProposal,
  ProfileImportResult,
} from "@/features/onboarding/schema";
import { PreferencesView } from "@/features/preferences/view";
import { ProfileView } from "@/features/profile/view";
import { apiRequest } from "@/lib/api";
import type { StoredDocument } from "@/profile-types";

type OnboardingStep =
  | "resume"
  | "profile"
  | "preferences"
  | "documents"
  | "finish";

export function OnboardingPage({
  onComplete,
  state,
}: {
  onComplete: (completedAt: string) => void;
  state: OnboardingState;
}) {
  const [profile, setProfile] = useState(state.profile);
  const [preferences, setPreferences] = useState(state.preferences);
  const [documents, setDocuments] = useState(state.documents);
  const [proposal, setProposal] = useState<ProfileImportProposal | null>(
    state.profileImport?.proposal ?? null
  );
  const [step, setStep] = useState<OnboardingStep>(() => initialStep(state));
  const [completing, setCompleting] = useState(false);

  const reloadDocuments = useCallback(async () => {
    const response = await apiRequest("/api/documents");
    const result = (await response.json()) as { documents: StoredDocument[] };
    setDocuments(result.documents);
  }, []);

  const imported = useCallback(
    (result: ProfileImportResult) => {
      setProfile(result.profile);
      setProposal(result.proposal);
      void reloadDocuments();
      setStep("profile");
    },
    [reloadDocuments]
  );

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
          initialImport={state.profileImport}
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
            setStep("documents");
          }}
          preferences={preferences}
          request={apiRequest}
        />
      ) : null}
      {step === "documents" ? (
        <>
          <DocumentsView
            documents={documents}
            onChanged={reloadDocuments}
            request={apiRequest}
          />
          <div className="mx-auto flex w-full max-w-7xl justify-end px-4 pb-10 sm:px-6">
            <Button
              disabled={
                completing ||
                !documents.some((document) => document.category === "resume")
              }
              onClick={() => void complete()}
            >
              {completing ? "Finishing…" : "Open my workspace"}
            </Button>
          </div>
        </>
      ) : null}
      {step === "finish" ? (
        <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
          <Card>
            <CardHeader>
              <CardTitle>Finish setting up JobKit</CardTitle>
              <CardDescription>
                Your profile, preferences, and resume are saved. Finish to open
                your matched-job workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              You can change any of these details later without repeating
              onboarding.
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
  const hasResume = state.documents.some(
    (document) => document.category === "resume"
  );
  if (state.hasProfile && state.hasPreferences && hasResume) {
    return "finish";
  }
  if (state.hasProfile && state.hasPreferences) {
    return "documents";
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
    documents: 3,
    finish: 3,
    preferences: 2,
    profile: 1,
    resume: 0,
  }[step];
  return (
    <div className="border-b bg-muted/20 px-4 py-3 sm:px-6">
      <ol className="mx-auto flex max-w-xl items-center justify-center gap-2 text-xs sm:gap-4">
        {["Resume", "Profile", "Preferences", "Documents"].map(
          (label, index) => (
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
          )
        )}
      </ol>
    </div>
  );
}
