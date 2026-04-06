"use client";

import Link from "next/link";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  PiggyBank,
  AlertCircle,
} from "lucide-react";
import { useGetSummary } from "@/features/summary/api/use-get-summary";
import { DataCard } from "@/components/dashboard/data-card";
import { CashFlowChart } from "@/components/dashboard/cash-flow-chart";
import { SpendingPie } from "@/components/dashboard/spending-pie";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  const { data, isLoading } = useGetSummary();

  return (
    <div className="space-y-6">
      {/* Review banner */}
      {data && data.categories.length > 0 && (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>Unreviewed transactions</AlertTitle>
          <AlertDescription>
            You may have transactions that need review.{" "}
            <Link href="/review" className="font-medium underline underline-offset-4">
              Review now
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <DataCard
          title="Total Balance"
          value={data?.total_balance}
          icon={Wallet}
          variant="default"
        />
        <DataCard
          title="Monthly Income"
          value={data?.income}
          icon={TrendingUp}
          percentageChange={data?.income_change}
          variant="success"
        />
        <DataCard
          title="Monthly Expenses"
          value={data?.expenses}
          icon={TrendingDown}
          percentageChange={data?.expenses_change}
          variant="danger"
        />
        <DataCard
          title="Net Cash Flow"
          value={data?.net_cash_flow}
          icon={ArrowUpDown}
          variant={
            data
              ? data.net_cash_flow >= 0
                ? "success"
                : "danger"
              : "default"
          }
        />
        <DataCard
          title="Savings Rate"
          value={data?.savings_rate}
          icon={PiggyBank}
          variant={
            data
              ? data.savings_rate >= 20
                ? "success"
                : data.savings_rate >= 0
                  ? "warning"
                  : "danger"
              : "default"
          }
        />
      </div>

      {/* Charts */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Skeleton className="h-[380px] w-full rounded-xl" />
          </div>
          <div className="lg:col-span-1">
            <Skeleton className="h-[380px] w-full rounded-xl" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CashFlowChart data={data?.daily ?? []} />
          </div>
          <div className="lg:col-span-1">
            <SpendingPie data={data?.categories ?? []} />
          </div>
        </div>
      )}
    </div>
  );
}
