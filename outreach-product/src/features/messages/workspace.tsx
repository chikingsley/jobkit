import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, RefreshCwIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GmailConnection } from "@/features/messages/gmail-connection";
import {
  messagesKeys,
  useMarkThreadRead,
  useMessageThread,
  useMessageThreads,
} from "@/features/messages/queries";
import { MessageThreadItem } from "@/features/messages/thread-item";
import { MessageThread } from "@/features/messages/thread-view";
import { useMessagesQueryState } from "@/features/workspace/query-state";
import { SplitWorkspace } from "@/features/workspace/split-workspace";
import type { ApiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

export function MessagesWorkspace({ request }: { request: ApiRequest }) {
  const {
    closeDetail,
    detailOpen,
    openThread,
    selectedThreadId,
    setSelectedThreadId,
  } = useMessagesQueryState();
  const queryClient = useQueryClient();
  const { data: threads, isLoading } = useMessageThreads();

  const activeThreadId = selectedThreadId || threads?.[0]?.threadId || "";

  useEffect(() => {
    const [firstThread] = threads ?? [];
    if (!selectedThreadId && firstThread) {
      setSelectedThreadId(firstThread.threadId);
    }
  }, [selectedThreadId, setSelectedThreadId, threads]);

  const { data: detail, isLoading: detailLoading } =
    useMessageThread(activeThreadId);
  const markThreadRead = useMarkThreadRead();

  const unreadCount =
    threads?.find((thread) => thread.threadId === activeThreadId)
      ?.unreadCount ?? 0;
  const { isPending: markingRead, mutate: markRead } = markThreadRead;
  useEffect(() => {
    if (!(detail && activeThreadId) || unreadCount === 0 || markingRead) {
      return;
    }
    markRead(activeThreadId);
  }, [detail, activeThreadId, unreadCount, markingRead, markRead]);

  return (
    <SplitWorkspace
      detail={
        <>
          <div className="split-workspace-back flex items-center gap-2 border-b bg-background px-4 py-2">
            <Button onClick={closeDetail} variant="ghost">
              <ChevronLeftIcon /> Messages
            </Button>
          </div>
          {detail && !detailLoading ? (
            <>
              <div className="split-workspace-detail-header shrink-0 border-b bg-background px-6 py-3">
                <h2 className="truncate font-semibold text-sm">
                  {detail.company || detail.title}
                </h2>
                <p className="truncate text-muted-foreground text-xs">
                  {detail.title} · {detail.recipient}
                </p>
              </div>
              <MessageThread
                detail={detail}
                onUpdated={() =>
                  queryClient.invalidateQueries({
                    queryKey: messagesKeys.thread(activeThreadId),
                  })
                }
                request={request}
              />
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
        </>
      }
      detailOpen={detailOpen}
      list={
        <>
          <div className="flex items-center justify-between px-4 py-3">
            {threads?.length ? (
              <p className="text-muted-foreground text-xs">
                {threads.length.toLocaleString()} conversation
                {threads.length === 1 ? "" : "s"}
              </p>
            ) : (
              <span />
            )}
            <Button
              aria-label="Refresh messages"
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: messagesKeys.threads,
                })
              }
              size="icon-sm"
              variant="ghost"
            >
              <RefreshCwIcon className={cn(isLoading && "animate-spin")} />
            </Button>
          </div>
          <GmailConnection />
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 p-2">
              {threads?.map((thread) => (
                <MessageThreadItem
                  active={thread.threadId === activeThreadId}
                  key={thread.threadId}
                  onSelect={() => void openThread(thread.threadId)}
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
        </>
      }
    />
  );
}
