import {
  Check,
  ChevronLeft,
  CircleAlert,
  Download,
  ExternalLink,
  File,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsPage } from "@/components/settings-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DocumentPacket } from "@/features/documents/types";
import { documentCategories, documentCategoryLabel } from "@/form-options";
import type { ApiRequest } from "@/lib/api";
import type { StoredDocument } from "@/profile-types";

export function DocumentsView({
  documents,
  request,
  onChanged,
}: {
  documents: StoredDocument[];
  request: ApiRequest;
  onChanged: () => Promise<void>;
}) {
  const [category, setCategory] = useState("resume");
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<StoredDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [packets, setPackets] = useState<DocumentPacket[]>([]);

  const loadPackets = useCallback(async () => {
    const response = await request("/api/document-packets");
    const data = (await response.json()) as { packets: DocumentPacket[] };
    setPackets(data.packets);
  }, [request]);

  useEffect(() => {
    void loadPackets().catch((error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Document packets could not load"
      )
    );
  }, [loadPackets]);

  useEffect(() => {
    if (!selected) {
      setPreviewUrl("");
      return;
    }
    let objectUrl = "";
    setPreviewing(true);
    void request(`/api/documents/${selected.id}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Document could not be loaded");
        }
        objectUrl = URL.createObjectURL(await response.blob());
        setPreviewUrl(objectUrl);
      })
      .catch((error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "Document could not be loaded"
        )
      )
      .finally(() => setPreviewing(false));
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [request, selected]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const response = await request("/api/documents", {
        body: file,
        headers: {
          "content-type": file.type,
          "x-jobkit-category": category,
          "x-jobkit-filename": encodeURIComponent(file.name),
        },
        method: "PUT",
      });
      if (!response.ok) {
        throw new Error(
          ((await response.json()) as { message?: string }).message ??
            "Upload failed"
        );
      }
      await onChanged();
      await loadPackets();
      toast.success("Document uploaded");
    } finally {
      setUploading(false);
    }
  }

  async function remove(document: StoredDocument) {
    const response = await request(`/api/documents/${document.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error("Document could not be deleted");
    }
    if (selected?.id === document.id) {
      setSelected(null);
    }
    await onChanged();
    await loadPackets();
    toast.success("Document deleted");
  }

  async function setDefaultPacket(packetId: string) {
    await request("/api/document-packets/default", {
      body: JSON.stringify({ packetId }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    await loadPackets();
    toast.success("Default attachment packet saved");
  }

  return (
    <SettingsPage
      description="Private files stored in R2 for applications and future email attachments."
      title="Application documents"
    >
      {selected ? null : (
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          {packets.map((packet) => (
            <Card key={packet.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{packet.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {packet.description}
                    </CardDescription>
                  </div>
                  {packet.isDefault ? (
                    <span className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground text-xs">
                      Default
                    </span>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="grid gap-2">
                {packet.items.map((item) => (
                  <div
                    className="flex items-center gap-2 text-sm"
                    key={item.category}
                  >
                    <Check className="size-4 text-emerald-600" />
                    <span className="min-w-0 truncate">{item.filename}</span>
                  </div>
                ))}
                {packet.missingCategories.map((missing) => (
                  <div
                    className="flex items-center gap-2 text-muted-foreground text-sm"
                    key={missing}
                  >
                    <CircleAlert className="size-4 text-amber-600" />
                    <span>{documentCategoryLabel(missing)} missing</span>
                  </div>
                ))}
                <p className="pt-2 text-muted-foreground text-xs">
                  This preset chooses email attachments. It does not decide
                  whether you qualify for a job.
                </p>
                {packet.isDefault ? null : (
                  <Button
                    className="mt-1 w-fit"
                    disabled={packet.missingCategories.length > 0}
                    onClick={() => void setDefaultPacket(packet.id)}
                    variant="outline"
                  >
                    Use by default
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected ? null : (
        <Card className="mb-4">
          <CardContent className="py-3">
            <Field orientation="responsive">
              <FieldContent>
                <FieldTitle>Upload document</FieldTitle>
                <FieldDescription>
                  PDF, DOCX, JPG, or PNG · maximum 10 MB.
                </FieldDescription>
              </FieldContent>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Select
                  items={[...documentCategories]}
                  onValueChange={(value) => setCategory(String(value))}
                  value={category}
                >
                  <SelectTrigger
                    aria-label="Document category"
                    className="w-full sm:w-60"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {documentCategories.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <label className={buttonVariants()} htmlFor="document-upload">
                  <Upload />
                  {uploading ? "Uploading…" : "Choose file"}
                  <input
                    accept=".pdf,.docx,.jpg,.jpeg,.png"
                    className="sr-only"
                    disabled={uploading}
                    id="document-upload"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void upload(file);
                      }
                    }}
                    type="file"
                  />
                </label>
              </div>
            </Field>
          </CardContent>
        </Card>
      )}

      <div>
        {selected ? null : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-3">
            {documents.map((document) => (
              <Item key={document.id} variant="outline">
                <button
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSelected(document)}
                  type="button"
                >
                  <ItemMedia
                    className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground"
                    variant="icon"
                  >
                    <File />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full truncate">
                      {document.filename}
                    </ItemTitle>
                    <ItemDescription>
                      {documentCategoryLabel(document.category)} ·{" "}
                      {formatBytes(document.size_bytes)}
                    </ItemDescription>
                  </ItemContent>
                </button>
                <ItemActions className="shrink-0">
                  <AlertDialog>
                    <AlertDialogTrigger
                      aria-label={`Delete ${document.filename}`}
                      render={<Button size="icon-sm" variant="ghost" />}
                    >
                      <Trash2 />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Delete this document?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {document.filename} will be permanently removed from
                          private storage.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => void remove(document)}
                          variant="destructive"
                        >
                          Delete document
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </ItemActions>
              </Item>
            ))}
          </div>
        )}

        {selected ? (
          <Card className="h-[calc(100svh-8rem)] min-h-[32rem]">
            <CardHeader className="border-b">
              <Button
                className="w-fit"
                onClick={() => setSelected(null)}
                variant="ghost"
              >
                <ChevronLeft /> All documents
              </Button>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="truncate">
                    {selected.filename}
                  </CardTitle>
                  <CardDescription>
                    {documentCategoryLabel(selected.category)} ·{" "}
                    {formatBytes(selected.size_bytes)}
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  {previewUrl ? (
                    <>
                      <Button
                        nativeButton={false}
                        render={
                          <a
                            href={previewUrl}
                            rel="noreferrer"
                            target="_blank"
                          />
                        }
                        size="icon-sm"
                        variant="ghost"
                      >
                        <ExternalLink />
                        <span className="sr-only">Open in new window</span>
                      </Button>
                      <Button
                        nativeButton={false}
                        render={
                          <a download={selected.filename} href={previewUrl} />
                        }
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Download />
                        <span className="sr-only">Download</span>
                      </Button>
                    </>
                  ) : null}
                  <Button
                    aria-label="Close viewer"
                    onClick={() => setSelected(null)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0">
              <DocumentPreview
                document={selected}
                loading={previewing}
                url={previewUrl}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </SettingsPage>
  );
}

function DocumentPreview({
  document,
  loading,
  url,
}: {
  document: StoredDocument;
  loading: boolean;
  url: string;
}) {
  if (loading) {
    return (
      <div className="grid h-full min-h-[28rem] place-items-center text-muted-foreground text-sm">
        Loading preview…
      </div>
    );
  }
  if (!url) {
    return (
      <div className="grid h-full min-h-[28rem] place-items-center text-muted-foreground text-sm">
        Preview unavailable.
      </div>
    );
  }
  if (document.content_type === "application/pdf") {
    return (
      <iframe
        className="h-full min-h-[34rem] w-full border-0"
        src={url}
        title={document.filename}
      />
    );
  }
  if (document.content_type.startsWith("image/")) {
    return (
      <div className="grid h-full min-h-[34rem] items-start justify-center overflow-auto bg-muted/30 p-4">
        <img
          alt={document.filename}
          className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
          height={900}
          src={url}
          width={1200}
        />
      </div>
    );
  }
  return (
    <div className="grid h-full min-h-[28rem] place-items-center p-8 text-center">
      <div>
        <File className="mx-auto size-10 text-muted-foreground" />
        <h3 className="mt-4 font-medium">
          Inline preview is not available for this file type
        </h3>
        <p className="mt-2 text-muted-foreground text-sm">
          Download it from the viewer toolbar. DOCX rendering will be added
          without opening another tab.
        </p>
      </div>
    </div>
  );
}

function formatBytes(value: number) {
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(value / 1024)} KB`;
}
