import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SplitWorkspace({
  detail,
  detailClassName,
  detailOpen,
  list,
  listClassName,
}: {
  detail: ReactNode;
  detailClassName?: string;
  detailOpen: boolean;
  list: ReactNode;
  listClassName?: string;
}) {
  return (
    <div
      className="split-workspace min-h-0 flex-1 overflow-hidden"
      data-detail-open={detailOpen ? "true" : "false"}
    >
      <section
        className={cn(
          "split-workspace-list min-h-0 flex-col bg-background",
          listClassName
        )}
      >
        {list}
      </section>
      <section
        className={cn(
          "split-workspace-detail min-h-0 min-w-0 flex-1 flex-col bg-muted/20",
          detailClassName
        )}
      >
        {detail}
      </section>
    </div>
  );
}
