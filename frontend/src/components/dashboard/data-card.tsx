"use client";

import { type LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import CountUp from "react-countup";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "danger" | "warning";

interface DataCardProps {
  title: string;
  value: number | undefined;
  icon: LucideIcon;
  percentageChange?: number;
  variant?: Variant;
}

const variantStyles: Record<
  Variant,
  { icon: string; badge: string; accent: string }
> = {
  default: {
    icon: "text-primary bg-primary/10",
    badge: "text-muted-foreground bg-muted",
    accent: "text-primary",
  },
  success: {
    icon: "text-emerald-600 bg-emerald-500/10",
    badge: "text-emerald-700 bg-emerald-500/10",
    accent: "text-emerald-600",
  },
  danger: {
    icon: "text-rose-600 bg-rose-500/10",
    badge: "text-rose-700 bg-rose-500/10",
    accent: "text-rose-600",
  },
  warning: {
    icon: "text-amber-600 bg-amber-500/10",
    badge: "text-amber-700 bg-amber-500/10",
    accent: "text-amber-600",
  },
};

export function DataCard({
  title,
  value,
  icon: Icon,
  percentageChange,
  variant = "default",
}: DataCardProps) {
  const styles = variantStyles[variant];

  if (value === undefined) {
    return <DataCardSkeleton />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className={cn("rounded-md p-2", styles.icon)}>
          <Icon className="size-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tracking-tight">
          <CountUp
            end={value}
            decimals={2}
            prefix="$"
            separator=","
            preserveValue
          />
        </div>
        {percentageChange !== undefined && (
          <div className="mt-1 flex items-center gap-1 text-xs">
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
                styles.badge
              )}
            >
              {percentageChange >= 0 ? (
                <TrendingUp className="size-3" />
              ) : (
                <TrendingDown className="size-3" />
              )}
              {Math.abs(percentageChange).toFixed(1)}%
            </span>
            <span className="text-muted-foreground">vs last month</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DataCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-8 rounded-md" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-32 mb-1" />
        <Skeleton className="h-4 w-40 mt-1" />
      </CardContent>
    </Card>
  );
}
