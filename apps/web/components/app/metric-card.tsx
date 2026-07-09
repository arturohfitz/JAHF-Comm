import type { LucideIcon } from "lucide-react";

export function MetricCard({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
}) {
  return (
    <article className="rounded-md border bg-card p-5 text-card-foreground">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-4 text-3xl font-semibold">{value}</p>
    </article>
  );
}
