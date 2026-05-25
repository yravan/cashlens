import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  tone?: "neutral" | "success" | "warning";
  children: React.ReactNode;
};

export function StatusBadge({ tone = "neutral", children }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
        tone === "success" && "bg-emerald-100 text-emerald-700",
        tone === "warning" && "bg-amber-100 text-amber-700",
        tone === "neutral" && "bg-slate-100 text-slate-700",
      )}
    >
      {children}
    </span>
  );
}
