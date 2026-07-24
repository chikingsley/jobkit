import { LoaderCircleIcon, MailCheckIcon, MailIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  useGmailStatus,
  useStartGmailWatch,
} from "@/features/messages/queries";
import { authClient } from "@/lib/auth-client";

const gmailScopes = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export function GmailConnection() {
  const [busy, setBusy] = useState(false);
  const callbackHandled = useRef(false);
  const { data: status } = useGmailStatus();
  const startWatchMutation = useStartGmailWatch();
  const { mutateAsync: startGmailWatch } = startWatchMutation;

  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get("gmail");
    if (linked !== "connected" || callbackHandled.current) {
      return;
    }
    callbackHandled.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    setBusy(true);
    startGmailWatch()
      .then((result) => {
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
  }, [startGmailWatch]);

  if (!status) {
    return null;
  }
  const watchActive = status.watch?.status === "active";
  const reconnectRequired =
    status.watch?.status === "error" &&
    status.watch.lastError.includes("Connect Gmail");
  let actionLabel = "Connect Google account";
  if (reconnectRequired) {
    actionLabel = "Reconnect Gmail";
  } else if (status.connected) {
    actionLabel = "Enable reply sync";
  }
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
      await startGmailWatch();
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
        onClick={() =>
          void (status.connected && !reconnectRequired
            ? startWatch()
            : connect())
        }
        size="sm"
      >
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <MailIcon />}
        {actionLabel}
      </Button>
    </div>
  );
}
