import { LoaderCircleIcon, MailCheckIcon, MailIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import type { ApiRequest } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const gmailScopes = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
];

interface GmailStatus {
  available: boolean;
  connected: boolean;
  emailAddress: string;
  watch: null | {
    expirationAt: string;
    lastError: string;
    lastSyncedAt: string | null;
    status: "active" | "error" | "expired";
  };
}

export function GmailConnection({ request }: { request: ApiRequest }) {
  const [busy, setBusy] = useState(false);
  const callbackHandled = useRef(false);
  const { data: status, mutate } = useSWR(
    "/api/gmail/status",
    async (path) => (await (await request(path)).json()) as GmailStatus,
    { refreshInterval: 60_000 }
  );

  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get("gmail");
    if (linked !== "connected" || callbackHandled.current) {
      return;
    }
    callbackHandled.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    setBusy(true);
    void request("/api/gmail/watch", { method: "POST" })
      .then(async (response) => {
        const result = (await response.json()) as { messagesRecorded: number };
        await mutate();
        toast.success(
          result.messagesRecorded > 0
            ? `Gmail connected and ${result.messagesRecorded} existing replies synced`
            : "Gmail connected and reply sync is active"
        );
      })
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Gmail setup failed"
        )
      )
      .finally(() => setBusy(false));
  }, [mutate, request]);

  if (!status) {
    return null;
  }
  const watchActive = status.watch?.status === "active";
  if (status.connected && watchActive) {
    return (
      <div className="flex items-center gap-2 border-b px-4 py-2 text-muted-foreground text-xs">
        <MailCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
        <span className="min-w-0 truncate">
          Gmail connected
          {status.emailAddress ? ` · ${status.emailAddress}` : ""}
        </span>
      </div>
    );
  }

  const connect = async () => {
    setBusy(true);
    try {
      const result = await authClient.linkSocial({
        callbackURL: "/messages?gmail=connected",
        provider: "google",
        scopes: gmailScopes,
      });
      if (result.error) {
        throw new Error(result.error.message || "Google did not start linking");
      }
    } catch (error) {
      setBusy(false);
      toast.error(
        error instanceof Error ? error.message : "Gmail connection failed"
      );
    }
  };

  const startWatch = async () => {
    setBusy(true);
    try {
      await request("/api/gmail/watch", { method: "POST" });
      await mutate();
      toast.success("Gmail reply sync is active");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gmail reply sync failed"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b bg-muted/30 p-3">
      <div className="mb-2 flex items-start gap-2">
        <MailIcon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium text-sm">
            {status.connected ? "Finish Gmail setup" : "Connect Gmail"}
          </p>
          <p className="text-muted-foreground text-xs">
            {status.available
              ? "Send applications here and sync replies into Messages."
              : "The hosted Gmail service still needs its Google credentials."}
          </p>
          {status.watch?.lastError ? (
            <p className="mt-1 text-destructive text-xs">
              {status.watch.lastError}
            </p>
          ) : null}
        </div>
      </div>
      <Button
        className="w-full"
        disabled={busy || !status.available}
        onClick={() => void (status.connected ? startWatch() : connect())}
        size="sm"
      >
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <MailIcon />}
        {status.connected ? "Enable reply sync" : "Connect Google account"}
      </Button>
    </div>
  );
}
