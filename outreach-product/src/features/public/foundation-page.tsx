import type { ReactNode } from "react";
import { foundationHead as buildFoundationHead } from "./seo";
import {
  PublicPageHeading,
  PublicPageMain,
  PublicSiteShell,
} from "./site-shell";

export function PublicFoundationPage({
  children,
  introduction,
  sections = [],
  title,
}: {
  children: ReactNode;
  introduction?: ReactNode;
  sections?: Array<{ body: ReactNode; title: string }>;
  title: string;
}) {
  return (
    <PublicSiteShell>
      <PublicPageMain className="max-w-4xl">
        <PublicPageHeading
          description={introduction ?? children}
          title={title}
        />
        {sections.length > 0 ? (
          <div className="mt-10 divide-y border-y">
            {sections.map((section) => (
              <section className="py-7" key={section.title}>
                <h2 className="font-semibold text-lg">{section.title}</h2>
                <div className="mt-2 max-w-[72ch] text-muted-foreground text-sm leading-7 sm:text-base">
                  {section.body}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </PublicPageMain>
    </PublicSiteShell>
  );
}

export const foundationHead = (
  title: string,
  description: string,
  canonicalPath: string
) => buildFoundationHead(title, description, canonicalPath);
