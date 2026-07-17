import { ChevronLeftIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageThreadItem } from "@/features/messages/thread-item";
import { MessageThread } from "@/features/messages/thread-view";
import type {
  MessageThreadDetail,
  MessageThreadSummary,
} from "@/features/messages/types";
import { useWorkspaceStore } from "@/features/workspace/store";
import type { ApiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

export function MessagesWorkspace({ request }: { request: ApiRequest }) {
  const selectedThreadId = useWorkspaceStore((state) => state.selectedThreadId);
  const setSelectedThreadId = useWorkspaceStore(
    (state) => state.setSelectedThreadId
  );
  const [showThread, setShowThread] = useState(false);

  const {
    data: threads,
    isLoading,
    mutate,
  } = useSWR("/api/messages", async (path) => {
    const payload = (await (await request(path)).json()) as {
      threads: MessageThreadSummary[];
    };
    return payload.threads;
  });

  const activeThreadId = selectedThreadId || threads?.[0]?.threadId || "";

  const { data: detail, isLoading: detailLoading } = useSWR(
    activeThreadId
      ? `/api/messages/threads/${encodeURIComponent(activeThreadId)}`
      : null,
    async (path) => {
      const payload = (await (await request(path)).json()) as {
        thread: MessageThreadDetail;
      };
      return payload.thread;
    }
  );

  const unreadCount =
    threads?.find((thread) => thread.threadId === activeThreadId)
      ?.unreadCount ?? 0;
  useEffect(() => {
    if (!(detail && activeThreadId) || unreadCount === 0) {
      return;
    }
    void request(
      `/api/messages/threads/${encodeURIComponent(activeThreadId)}/read`,
      { method: "POST" }
    ).then(() => mutate());
  }, [detail, activeThreadId, unreadCount, request, mutate]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <section
        className={cn(
          "h-full min-h-0 w-full flex-col border-e bg-background sm:flex sm:max-w-sm",
          showThread ? "hidden" : "flex"
        )}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h2 className="font-semibold text-sm">Messages</h2>
            <p className="text-muted-foreground text-xs">
              {threads?.length
                ? `${threads.length.toLocaleString()} conversation${threads.length === 1 ? "" : "s"}`
                : "Sent applications appear here"}
            </p>
          </div>
          <Button
            aria-label="Refresh messages"
            onClick={() => void mutate()}
            size="icon-sm"
            variant="ghost"
          >
            <RefreshCwIcon className={cn(isLoading && "animate-spin")} />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1 p-2">
            {threads?.map((thread) => (
              <MessageThreadItem
                active={thread.threadId === activeThreadId}
                key={thread.threadId}
                onSelect={() => {
                  setSelectedThreadId(thread.threadId);
                  setShowThread(true);
                }}
                thread={thread}
              />
            ))}
            {threads && threads.length === 0 ? (
              <p className="px-3 py-10 text-center text-muted-foreground text-sm">
                No messages yet. Applications you send by email will show up
                here as conversations.
              </p>
            ) : null}
          </div>
        </ScrollArea>
      </section>
      <div
        className={cn(
          "min-h-0 flex-1 flex-col bg-muted/20",
          showThread ? "flex" : "hidden sm:flex"
        )}
      >
        <div className="flex items-center gap-2 border-b bg-background px-4 py-2 sm:hidden">
          <Button onClick={() => setShowThread(false)} variant="ghost">
            <ChevronLeftIcon /> Messages
          </Button>
        </div>
        {detail && !detailLoading ? (
          <>
            <div className="hidden shrink-0 border-b bg-background px-6 py-3 sm:block">
              <h2 className="truncate font-semibold text-sm">
                {detail.company || detail.title}
              </h2>
              <p className="truncate text-muted-foreground text-xs">
                {detail.title} · {detail.recipient}
              </p>
            </div>
            <MessageThread detail={detail} />
          </>
        ) : (
          <div className="grid min-h-[24rem] flex-1 place-items-center p-8 text-center">
            <p className="text-muted-foreground text-sm">
              {activeThreadId
                ? "Loading conversation…"
                : "Select a conversation to read the thread."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
