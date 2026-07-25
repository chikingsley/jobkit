import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SettingsSection({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={cn("border-t pt-5", className)}>
      <h2 className="mb-4 font-semibold text-base">{title}</h2>
      {children}
    </section>
  );
}
