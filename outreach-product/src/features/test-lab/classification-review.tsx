import { useQueryClient } from "@tanstack/react-query";
import { Check, GitCompareArrows, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { classificationLabel } from "@/features/test-lab/classification-labels";
import { ClassificationReviewDetail } from "@/features/test-lab/classification-review-detail";
import {
  testLabKeys,
  useClassificationReview as useClassificationReviewQuery,
} from "@/features/test-lab/queries";
import type {
  ClassificationAdjudication,
  ClassificationReviewResponse,
} from "@/features/test-lab/types";
import { SplitWorkspace } from "@/features/workspace/split-workspace";
import type { ApiRequest } from "@/lib/api";

export function ClassificationReview({
  request,
  selectedCaseId,
  setSelectedCaseId,
}: {
  request: ApiRequest;
  selectedCaseId: string;
  setSelectedCaseId: (itemId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();
  const { data, isLoading } = useClassificationReviewQuery();
  const adjudications = useMemo(
    () =>
      new Map(
        (data?.adjudications ?? []).map((decision) => [
          decision.itemId,
          decision,
        ])
      ),
    [data?.adjudications]
  );
  const reviewCase = data?.cases.find((item) => item.itemId === selectedCaseId);
  const filteredCases = useMemo(() => {
    if (!data) {
      return [];
    }
    const normalized = query.trim().toLocaleLowerCase("en");
    return data.cases
      .filter(
        (item) =>
          !normalized ||
          `${item.title} ${item.company} ${item.country} ${item.board} ${item.itemId}`
            .toLocaleLowerCase("en")
            .includes(normalized)
      )
      .toSorted((left, right) => {
        const leftDone = Number(adjudications.has(left.itemId));
        const rightDone = Number(adjudications.has(right.itemId));
        return leftDone - rightDone || left.title.localeCompare(right.title);
      });
  }, [adjudications, data, query]);

  async function decisionChanged(itemId: string) {
    await queryClient.invalidateQueries({
      queryKey: testLabKeys.classificationReview,
    });
    const next = data?.cases.find(
      (item) => item.itemId !== itemId && !adjudications.has(item.itemId)
    );
    if (next) {
      setSelectedCaseId(next.itemId);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="grid h-[calc(100svh-15.5rem)] min-h-[34rem] place-items-center text-muted-foreground text-sm">
        Loading classification disagreements…
      </div>
    );
  }

  return (
    <SplitWorkspace
      detail={
        reviewCase ? (
          <ClassificationReviewDetail
            adjudication={adjudications.get(reviewCase.itemId)}
            key={`${reviewCase.itemId}:${adjudications.get(reviewCase.itemId)?.updatedAt ?? "new"}`}
            onBack={() => setSelectedCaseId("")}
            onDecisionChanged={decisionChanged}
            request={request}
            reviewCase={reviewCase}
          />
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center text-muted-foreground text-sm">
            Select a disagreement to compare both blind passes with the source
            text.
          </div>
        )
      }
      detailClassName="h-[calc(100svh-15.5rem)] min-h-[34rem]"
      detailOpen={Boolean(reviewCase)}
      list={
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid gap-3 border-b p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {data.summary.remaining} remaining
              </Badge>
              <Badge variant="outline">{data.summary.decided} decided</Badge>
              <Badge variant="outline">{data.corpusVersion}</Badge>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search classification disagreements"
                className="pl-8"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search 23 disagreements"
                value={query}
              />
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-1 p-2">
              {filteredCases.map((item) => (
                <ReviewCaseButton
                  active={item.itemId === selectedCaseId}
                  adjudication={adjudications.get(item.itemId)}
                  key={item.itemId}
                  onClick={() => setSelectedCaseId(item.itemId)}
                  reviewCase={item}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      }
      listClassName="h-[calc(100svh-15.5rem)] min-h-[34rem]"
    />
  );
}

function ReviewCaseButton({
  active,
  adjudication,
  onClick,
  reviewCase,
}: {
  active: boolean;
  adjudication: ClassificationAdjudication | undefined;
  onClick: () => void;
  reviewCase: ClassificationReviewResponse["cases"][number];
}) {
  return (
    <button
      className="grid w-full gap-1.5 rounded-md px-3 py-2.5 text-left hover:bg-muted data-[active=true]:bg-muted"
      data-active={active}
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        {adjudication ? (
          <Check className="size-3.5 shrink-0 text-primary" />
        ) : (
          <GitCompareArrows className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-medium text-sm">{reviewCase.title}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 pl-5 text-muted-foreground text-xs">
        <span className="truncate">{reviewCase.board}</span>
        <span aria-hidden="true">·</span>
        {adjudication ? (
          <span className="truncate">
            {classificationLabel(adjudication.label)}
          </span>
        ) : (
          <span className="truncate">
            {reviewCase.labels
              .map((item) => classificationLabel(item.label))
              .join(" / ")}
          </span>
        )}
      </span>
    </button>
  );
}
