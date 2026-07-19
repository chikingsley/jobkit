import { Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { monthlyCompensationUsd } from "@/features/jobs/compensation";
import type { FxData, Job } from "@/features/jobs/types";
import type { QualificationClaims } from "@/features/matching/claims";
import { evaluateJob } from "@/features/matching/evaluate";
import { SplitWorkspace } from "@/features/workspace/split-workspace";
import type { ApiRequest } from "@/lib/api";
import type { Preferences, Profile, StoredDocument } from "@/profile-types";
import { ApplicationSetPanel } from "./application-set-panel";
import { AneslPositionItem } from "./position-item";
import type { AneslApplicationSet } from "./types";

const PAGE_SIZE = 100;
const AGENT_TASK_REFRESH_INTERVAL_MS = 1000;

interface AneslPositionPage {
  hasMore: boolean;
  positions: Job[];
  total: number;
}

export function AneslWorkspace({
  documents,
  fx,
  preferences,
  profile,
  qualificationClaims,
  request,
}: {
  documents: StoredDocument[];
  fx: FxData;
  preferences: Preferences | null;
  profile: Profile | null;
  qualificationClaims: QualificationClaims;
  request: ApiRequest;
}) {
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const deferredQuery = useDeferredValue(query.trim());
  const { data, mutate: mutateSets } = useSWR(
    "/api/anesl/application-sets",
    async (path) =>
      (
        (await (await request(path)).json()) as {
          applicationSets: AneslApplicationSet[];
        }
      ).applicationSets,
    {
      refreshInterval: (sets) =>
        sets?.some(
          (set) =>
            set.draftTask?.status === "queued" ||
            set.draftTask?.status === "claimed"
        )
          ? AGENT_TASK_REFRESH_INTERVAL_MS
          : 0,
    }
  );
  const {
    data: positionPages,
    isValidating: positionsLoading,
    mutate: mutatePositions,
    setSize,
    size,
  } = useSWRInfinite<AneslPositionPage>(
    (pageIndex, previousPage) => {
      if (previousPage && !previousPage.hasMore) {
        return null;
      }
      const parameters = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageIndex * PAGE_SIZE),
      });
      if (deferredQuery) {
        parameters.set("q", deferredQuery);
      }
      return `/api/anesl/positions?${parameters.toString()}`;
    },
    async (path) => (await (await request(path)).json()) as AneslPositionPage
  );
  const currentSet = data?.find((set) =>
    ["review", "approved", "failed"].includes(set.status)
  );
  const candidates = useMemo(
    () => positionPages?.flatMap((page) => page.positions) ?? [],
    [positionPages]
  );
  const matches = useMemo(
    () =>
      new Map(
        profile && preferences
          ? candidates.map((job) => [
              job.id,
              evaluateJob(
                job,
                profile,
                preferences,
                monthlyCompensationUsd(job.compensation, fx),
                documents,
                qualificationClaims
              ),
            ])
          : []
      ),
    [candidates, documents, fx, preferences, profile, qualificationClaims]
  );
  const positions = useMemo(
    () =>
      [...candidates].sort(
        (left, right) =>
          (matches.get(right.id)?.score ?? 0) -
            (matches.get(left.id)?.score ?? 0) ||
          (right.compensation.amountMax ?? 0) -
            (left.compensation.amountMax ?? 0)
      ),
    [candidates, matches]
  );
  const total = positionPages?.[0]?.total ?? 0;
  const hasMore = positionPages?.at(-1)?.hasMore ?? false;

  function toggle(jobId: string, checked: boolean) {
    setSelectedIds((current) => {
      if (!checked) {
        return current.filter((id) => id !== jobId);
      }
      return current.length < 5 ? [...current, jobId] : current;
    });
  }

  async function createSet() {
    setBusy("create");
    try {
      await request("/api/anesl/application-sets", {
        body: JSON.stringify({ jobIds: selectedIds }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setSelectedIds([]);
      await Promise.all([mutateSets(), mutatePositions()]);
      toast.success("ANESL application set queued for Codex drafting");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Application set could not be created"
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <SplitWorkspace
      detail={
        <ScrollArea className="min-h-0 flex-1">
          {currentSet ? (
            <ApplicationSetPanel
              applicationSet={currentSet}
              busy={busy}
              onBusy={setBusy}
              onChanged={async () => {
                await Promise.all([mutateSets(), mutatePositions()]);
              }}
              request={request}
            />
          ) : (
            <div className="grid min-h-[30rem] place-items-center p-8 text-center">
              <div className="max-w-md">
                <h2 className="font-semibold text-xl">
                  Build one ANESL application set
                </h2>
                <p className="mt-2 text-muted-foreground text-sm leading-6">
                  Select the strongest one to five position IDs. JobKit will
                  create one shared message, freeze one document packet, and
                  track every selected position under the same Gmail thread.
                </p>
              </div>
            </div>
          )}
        </ScrollArea>
      }
      detailOpen={Boolean(currentSet)}
      list={
        <>
          <div className="border-b p-4">
            <h2 className="font-semibold text-sm">
              Choose up to five positions
            </h2>
            <p className="mt-1 text-muted-foreground text-xs">
              {total.toLocaleString()} available · {selectedIds.length} selected
            </p>
            <div className="relative mt-3">
              <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                onChange={(event) => {
                  setQuery(event.target.value);
                  void setSize(1);
                }}
                placeholder="Search ID, title, or city"
                value={query}
              />
            </div>
            <Button
              className="mt-3 w-full"
              disabled={
                Boolean(currentSet) || selectedIds.length === 0 || Boolean(busy)
              }
              onClick={() => void createSet()}
            >
              {busy === "create"
                ? "Creating application set…"
                : `Review ${selectedIds.length || "selected"} position${selectedIds.length === 1 ? "" : "s"}`}
            </Button>
            {currentSet ? (
              <p className="mt-2 text-muted-foreground text-xs">
                Finish or start over from the current set before choosing
                another batch.
              </p>
            ) : null}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-2 p-2">
              {positions.map((job) => {
                const checked = selectedIds.includes(job.id);
                return (
                  <AneslPositionItem
                    checked={checked}
                    disabled={
                      Boolean(currentSet) ||
                      (!checked && selectedIds.length >= 5)
                    }
                    fx={fx}
                    job={job}
                    key={job.id}
                    match={matches.get(job.id)}
                    onCheckedChange={(next) => toggle(job.id, next)}
                  />
                );
              })}
              {hasMore ? (
                <Button
                  disabled={positionsLoading}
                  onClick={() => void setSize(size + 1)}
                  variant="outline"
                >
                  {positionsLoading ? "Loading…" : "Show 100 more"}
                </Button>
              ) : null}
            </div>
          </ScrollArea>
        </>
      }
    />
  );
}
