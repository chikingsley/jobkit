import { Link } from "@tanstack/react-router";
import type { PropsWithChildren, ReactNode } from "react";
import { ModeToggle } from "@/components/mode-toggle";
import { cn } from "@/lib/utils";

export function PublicSiteShell({ children }: PropsWithChildren) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-5 px-4 sm:px-6">
          <Link className="font-semibold tracking-tight" to="/">
            JobKit
          </Link>
          <nav
            aria-label="Primary"
            className="flex min-w-0 items-center gap-4 text-sm"
          >
            <Link activeProps={{ className: "text-foreground" }} to="/jobs">
              Jobs
            </Link>
            <Link
              activeProps={{ className: "text-foreground" }}
              className="hidden text-muted-foreground hover:text-foreground sm:inline"
              to="/methodology"
            >
              Methodology
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Link
              className="inline-flex min-h-9 items-center rounded-lg px-3 font-medium text-sm hover:bg-muted"
              to="/app/jobs"
            >
              Workspace
            </Link>
            <ModeToggle />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

export function PublicPageMain({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <main
      className={cn(
        "mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10",
        className
      )}
    >
      {children}
    </main>
  );
}

export function PublicPageHeading({
  description,
  title,
}: {
  description?: ReactNode;
  title: string;
}) {
  return (
    <div className="max-w-3xl">
      <h1 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
        {title}
      </h1>
      {description ? (
        <div className="mt-2 text-muted-foreground text-sm leading-6 sm:text-base">
          {description}
        </div>
      ) : null}
    </div>
  );
}
