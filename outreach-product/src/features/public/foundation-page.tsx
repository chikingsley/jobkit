import type { ReactNode } from "react";
import {
  PublicPageHeading,
  PublicPageMain,
  PublicSiteShell,
} from "./site-shell";

export function PublicFoundationPage({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <PublicSiteShell>
      <PublicPageMain className="grid min-h-[calc(100svh-3.5rem)] content-center">
        <PublicPageHeading description={children} title={title} />
      </PublicPageMain>
    </PublicSiteShell>
  );
}

export const foundationHead = (title: string, description: string) => ({
  meta: [
    { title },
    { content: description, name: "description" },
    { content: "noindex,follow", name: "robots" },
  ],
});
