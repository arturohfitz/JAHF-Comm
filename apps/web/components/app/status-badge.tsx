import { humanizeEnum } from "@/lib/format";

const colorByValue: Record<string, string> = {
  OPEN: "border-emerald-200 bg-emerald-50 text-emerald-700",
  NEW: "border-sky-200 bg-sky-50 text-sky-700",
  SOLD: "border-teal-200 bg-teal-50 text-teal-700",
  PAID: "border-teal-200 bg-teal-50 text-teal-700",
  PROCESSED: "border-teal-200 bg-teal-50 text-teal-700",
  RECEIVED: "border-sky-200 bg-sky-50 text-sky-700",
  CONNECTED: "border-teal-200 bg-teal-50 text-teal-700",
  DISCONNECTED: "border-zinc-200 bg-zinc-50 text-zinc-700",
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  PENDING_PAYMENT: "border-amber-200 bg-amber-50 text-amber-700",
  DUPLICATE: "border-amber-200 bg-amber-50 text-amber-700",
  ESCALATED: "border-red-200 bg-red-50 text-red-700",
  OVERDUE: "border-red-200 bg-red-50 text-red-700",
  FAILED: "border-red-200 bg-red-50 text-red-700",
  UNAUTHORIZED: "border-red-200 bg-red-50 text-red-700",
  ERROR: "border-red-200 bg-red-50 text-red-700",
  CANCELLED: "border-zinc-200 bg-zinc-50 text-zinc-700",
  RESOLVED: "border-teal-200 bg-teal-50 text-teal-700"
};

export function StatusBadge({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${
        colorByValue[value] ?? "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      {humanizeEnum(value)}
    </span>
  );
}
