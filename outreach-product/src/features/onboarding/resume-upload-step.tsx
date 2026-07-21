import { FileText, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AgentRunnerConnectionCard,
  useAgentRunners,
} from "@/features/agents/runner-connection-card";
import type {
  OnboardingState,
  ProfileImportQueuedResult,
  ProfileImportResult,
} from "@/features/onboarding/schema";
import { apiRequest } from "@/lib/api";

const acceptedTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/markdown",
  "text/plain",
]);

export function ResumeUploadStep({
  initialImport,
  onImported,
  onManual,
}: {
  initialImport: OnboardingState["profileImport"];
  onImported: (result: ProfileImportResult) => void;
  onManual: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importId, setImportId] = useState<string | null>(() =>
    initialImport?.status === "processing" ? initialImport.id : null
  );
  const { hasCapability, isLoading: runnersLoading } =
    useAgentRunners(apiRequest);
  const canExtract = hasCapability("extraction");
  const { data: importState, error: importStatusError } = useSWR(
    importId ? "/api/onboarding" : null,
    async (path) => (await (await apiRequest(path)).json()) as OnboardingState,
    { errorRetryInterval: 3000, refreshInterval: 1500 }
  );

  useEffect(() => {
    if (!(importId && importState?.profileImport?.id === importId)) {
      return;
    }
    const { profileImport, profile } = importState;
    if (profileImport.status === "failed") {
      setImportId(null);
      setError(profileImport.errorMessage ?? "Resume extraction failed");
      return;
    }
    if (profileImport.status !== "ready") {
      return;
    }
    const { proposal } = profileImport;
    if (!proposal) {
      setImportId(null);
      setError("The completed resume import had no proposal");
      return;
    }
    setImportId(null);
    onImported({ id: importId, profile, proposal, status: "ready" });
  }, [importId, importState, onImported]);

  useEffect(() => {
    if (importStatusError) {
      setError(
        importStatusError instanceof Error
          ? importStatusError.message
          : "Resume status could not be checked"
      );
    }
  }, [importStatusError]);

  function choose(next: File | null) {
    setError("");
    if (!next) {
      setFile(null);
      return;
    }
    if (!acceptedTypes.has(next.type)) {
      setFile(null);
      setError("Choose a PDF, DOCX, PPTX, image, Markdown, or text resume.");
      return;
    }
    if (next.size > 5 * 1024 * 1024) {
      setFile(null);
      setError("Resume files must be 5 MB or smaller.");
      return;
    }
    setFile(next);
  }

  async function upload() {
    if (!file) {
      input.current?.click();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest("/api/profile-imports", {
        body: file,
        headers: {
          "content-type": file.type,
          "x-jobkit-filename": encodeURIComponent(file.name),
        },
        method: "PUT",
      });
      const result = (await response.json()) as ProfileImportQueuedResult;
      setImportId(result.id);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The resume could not be processed"
      );
    } finally {
      setBusy(false);
    }
  }

  const processing = importId !== null;
  const actionLabel = resumeActionLabel(busy, processing);
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4 px-4 py-10 sm:px-6">
      <div className="text-center">
        <h1 className="font-semibold text-3xl tracking-tight">
          Start with your resume
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-muted-foreground text-sm leading-6">
          JobKit will extract a reviewable profile. Nothing becomes an
          application fact until you confirm it.
        </p>
      </div>
      {runnersLoading || canExtract ? null : (
        <AgentRunnerConnectionCard
          description="Resume import runs through your Codex login. Pair it once, then this page can extract the resume into reviewable profile facts."
          request={apiRequest}
          title="Connect Codex before importing"
        />
      )}
      <Card>
        <CardHeader>
          <CardTitle>Upload a resume</CardTitle>
          <CardDescription>
            PDF, Word, PowerPoint, image, Markdown, or text, up to 5 MB. The
            original stays private in your document storage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <button
            className="flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/30 p-6 text-center outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => input.current?.click()}
            type="button"
          >
            {file ? (
              <FileText className="size-8 text-primary" />
            ) : (
              <Upload className="size-8 text-muted-foreground" />
            )}
            <span className="font-medium">
              {file ? file.name : "Choose your resume"}
            </span>
            <span className="text-muted-foreground text-xs">
              {file
                ? `${Math.max(1, Math.round(file.size / 1024))} KB`
                : "Select a file from this device"}
            </span>
          </button>
          <Input
            accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png,.webp,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp,text/markdown,text/plain"
            className="sr-only"
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
            ref={input}
            type="file"
          />
          {error ? (
            <p className="mt-3 text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            disabled={busy || processing}
            onClick={onManual}
            variant="ghost"
          >
            Build my profile manually
          </Button>
          <Button
            disabled={busy || processing || runnersLoading || !canExtract}
            onClick={() => void upload()}
          >
            <Upload />
            {actionLabel}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function resumeActionLabel(busy: boolean, processing: boolean) {
  if (busy) {
    return "Reading document…";
  }
  if (processing) {
    return "Waiting for your Codex agent…";
  }
  return "Continue with resume";
}
