import type { ReactNode } from "react";

export function SettingsPage({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="max-w-2xl">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        <p className="mt-1 text-muted-foreground text-sm leading-6">
          {description}
        </p>
      </header>
      {children}
    </section>
  );
}
