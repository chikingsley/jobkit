import type { JobContentAnalysis } from "@/features/jobs/content-analysis";
import { SourceDescription } from "@/features/jobs/source-description";
import type { ApplicationRoute } from "@/features/jobs/types";

export function NormalizedJobDescription({
  analysis,
  description,
  routes,
}: {
  analysis: JobContentAnalysis | null;
  description: string;
  routes: ApplicationRoute[];
}) {
  if (!analysis) {
    return <SourceDescription description={description} routes={routes} />;
  }
  return (
    <div className="mt-3 max-w-[72ch] space-y-6 text-foreground/85 text-sm leading-6">
      <div className="space-y-3">
        {analysis.overview.map((item) => (
          <p key={item.text}>{item.text}</p>
        ))}
      </div>

      <TextList items={analysis.responsibilities} title="Responsibilities" />

      <FactList items={analysis.teachingContext} title="Teaching context" />

      <FactList
        items={analysis.scheduleAndContract}
        title="Schedule and contract"
      />

      {analysis.additionalSections.map((section) => (
        <TextList
          items={section.items}
          key={section.title}
          title={section.title}
        />
      ))}

      <TextList items={analysis.applicationProcess} title="How to apply" />
    </div>
  );
}

function TextList({
  items,
  title,
}: {
  items: Array<{ text: string }>;
  title: string;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div>
      <h4 className="font-semibold text-foreground">{title}</h4>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-muted-foreground">
        {items.map((item) => (
          <li key={item.text}>{item.text}</li>
        ))}
      </ul>
    </div>
  );
}

function FactList({
  items,
  title,
}: {
  items: Array<{ label: string; value: string }>;
  title: string;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div>
      <h4 className="font-semibold text-foreground">{title}</h4>
      <dl className="mt-2 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={`${item.label}:${item.value}`}>
            <dt className="font-medium text-muted-foreground text-xs">
              {item.label}
            </dt>
            <dd className="mt-0.5">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
