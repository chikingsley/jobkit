import { FileText, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDocuments } from "@/features/documents/queries";
import { useStartDocumentBenchmark } from "@/features/test-lab/queries";
import { TestLabRunResult } from "@/features/test-lab/run-result";
import type { TestLabResponse } from "@/features/test-lab/types";

type DocumentVariant = "codex_vision" | "deterministic" | "mistral_ocr";

const variantLabels: Record<DocumentVariant, string> = {
  codex_vision: "Codex vision",
  deterministic: "deterministic extraction",
  mistral_ocr: "Mistral OCR",
};

export function DocumentLab({
  data,
  onRefresh,
}: {
  data: TestLabResponse;
  onRefresh: () => Promise<unknown>;
}) {
  const { data: documentsData } = useDocuments("all");
  const documents = documentsData ?? [];
  const benchmarkMutation = useStartDocumentBenchmark();
  const [documentId, setDocumentId] = useState("");
  const [expectedText, setExpectedText] = useState("");
  const [busy, setBusy] = useState<DocumentVariant | "">("");
  const selectedDocument = documents.find(
    (document) => document.id === documentId
  );
  const documentRuns = data.runs.filter(
    (runItem) =>
      runItem.caseKind === "document" &&
      readDocumentId(runItem.input) === documentId
  );

  useEffect(() => {
    if (!documentId && documents[0]?.id) {
      setDocumentId(documents[0].id);
    }
  }, [documentId, documents]);

  async function startVariant(variant: DocumentVariant) {
    if (!documentId) {
      return;
    }
    setBusy(variant);
    try {
      const result = await benchmarkMutation.mutateAsync({
        documentId,
        expectedText,
        variant,
      });
      await onRefresh();
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Document benchmark failed"
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">explicit benchmark runs</Badge>
            <Badge variant="outline">page-level output</Badge>
          </div>
          <CardTitle>Document benchmark</CardTitle>
          <CardDescription>
            Compare each extractor explicitly on the same immutable document
            version. Production uses deterministic extraction first, Mistral OCR
            for unreadable scans, and Codex vision only as an audit comparator.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {documents.length > 0 ? (
            <Select
              items={documents.map((document) => ({
                label: document.filename,
                value: document.id,
              }))}
              onValueChange={(value) => value && setDocumentId(value)}
              value={documentId}
            >
              <SelectTrigger aria-label="Benchmark document" className="w-full">
                <SelectValue placeholder="Choose an uploaded document" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {documents.map((document) => (
                    <SelectItem key={document.id} value={document.id}>
                      {document.filename}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              Upload a controlled PDF, DOCX, JPG, or PNG from Documents first.
            </div>
          )}
          {selectedDocument ? (
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <FileText className="size-4" />
              <span>{selectedDocument.content_type}</span>
              <span>·</span>
              <span>{formatBytes(selectedDocument.size_bytes)}</span>
              <span>·</span>
              <span>{selectedDocument.category}</span>
            </div>
          ) : null}
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="document-benchmark-ground-truth"
          >
            <span className="font-medium">Optional ground-truth text</span>
            <Textarea
              className="min-h-44 font-mono text-xs leading-5"
              id="document-benchmark-ground-truth"
              onChange={(event) => setExpectedText(event.target.value)}
              placeholder="Paste an exact transcript to record token F1 and exact-match metrics. Leave blank to inspect outputs without a quality score."
              value={expectedText}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {(["deterministic", "codex_vision", "mistral_ocr"] as const).map(
              (variant) => (
                <Button
                  disabled={
                    !selectedDocument ||
                    Boolean(busy) ||
                    (variant === "codex_vision" &&
                      !supportsCodexVision(selectedDocument.content_type)) ||
                    (variant === "mistral_ocr" && !data.integrations.mistralOcr)
                  }
                  key={variant}
                  onClick={() => void startVariant(variant)}
                  variant={variant === "deterministic" ? "default" : "outline"}
                >
                  <Play />
                  {busy === variant
                    ? "Running…"
                    : `Run ${variantLabels[variant]}`}
                </Button>
              )
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {documentRuns.map((runItem) => (
          <TestLabRunResult key={runItem.id} run={runItem} />
        ))}
      </div>
      {selectedDocument && documentRuns.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          Run two or more variants to compare their text, pages, timing, and
          provenance.
        </div>
      ) : null}
    </div>
  );
}

function readDocumentId(input: unknown) {
  return input && typeof input === "object" && "documentId" in input
    ? String(input.documentId)
    : "";
}

function supportsCodexVision(contentType: string) {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
