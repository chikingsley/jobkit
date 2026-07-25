import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { apiRequest } from "@/lib/api";

const TIME_ZONE_STORAGE_KEY = "jobkit-synced-time-zone";

function storedTimeZone(): string | null {
  try {
    return window.localStorage.getItem(TIME_ZONE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberTimeZone(timeZone: string) {
  try {
    window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, timeZone);
  } catch (ignored) {
    void ignored;
  }
}

export function useTimeZoneSync() {
  const mutation = useMutation({
    mutationFn: async (timeZone: string) => {
      await apiRequest("/api/time-zone", {
        body: JSON.stringify({ timeZone }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      return timeZone;
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Time zone could not be saved"
      ),
    onSuccess: (timeZone) => rememberTimeZone(timeZone),
  });
  const { mutate } = mutation;

  useEffect(() => {
    const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
    if (!timeZone || storedTimeZone() === timeZone) {
      return;
    }
    mutate(timeZone);
  }, [mutate]);
}
