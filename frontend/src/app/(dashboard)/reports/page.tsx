"use client";

import { cn, formatCurrency } from "@/lib/utils";
import { useGetSummary } from "@/features/summary/api/use-get-summary";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------
const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "#f97316",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
];

// ---------------------------------------------------------------------------
// Chart configs
// ---------------------------------------------------------------------------
const cashFlowConfig = {
  income: { label: "Income", color: "var(--color-chart-2)" },
  expenses: { label: "Expenses", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

const monthlyCompareConfig = {
  thisMonth: { label: "This Month", color: "var(--color-chart-1)" },
  lastMonth: { label: "Last Month", color: "var(--color-chart-3)" },
} satisfies ChartConfig;

const netFlowConfig = {
  net: { label: "Net Cash Flow", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

// ---------------------------------------------------------------------------
// Mock data for tabs that need data beyond what useGetSummary provides
// ---------------------------------------------------------------------------
const MOCK_MONTHLY_COMPARE = [
  { category: "Housing", thisMonth: 1400, lastMonth: 1400 },
  { category: "Food", thisMonth: 620, lastMonth: 580 },
  { category: "Transport", thisMonth: 280, lastMonth: 310 },
  { category: "Entertainment", thisMonth: 150, lastMonth: 200 },
  { category: "Shopping", thisMonth: 340, lastMonth: 190 },
  { category: "Utilities", thisMonth: 180, lastMonth: 175 },
];

const MOCK_NET_FLOW = [
  { month: "Nov", net: 420 },
  { month: "Dec", net: -180 },
  { month: "Jan", net: 310 },
  { month: "Feb", net: 550 },
  { month: "Mar", net: 280 },
  { month: "Apr", net: 640 },
];

const MOCK_BUDGETS = [
  { category: "Housing", spent: 1400, budget: 1500 },
  { category: "Food & Dining", spent: 620, budget: 600 },
  { category: "Transportation", spent: 280, budget: 350 },
  { category: "Entertainment", spent: 150, budget: 200 },
  { category: "Shopping", spent: 340, budget: 300 },
  { category: "Utilities", spent: 180, budget: 200 },
  { category: "Health", spent: 90, budget: 150 },
  { category: "Subscriptions", spent: 65, budget: 80 },
];

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------
function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-[300px] w-full rounded-xl" />
    </div>
  );
}

function CardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-48" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Trend icon helper
// ---------------------------------------------------------------------------
function TrendIcon({ value }: { value: number }) {
  if (value > 0) return <TrendingUp className="size-4 text-emerald-500" />;
  if (value < 0) return <TrendingDown className="size-4 text-red-500" />;
  return <Minus className="size-4 text-muted-foreground" />;
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------
function OverviewTab({
  daily,
  categories,
  isLoading,
}: {
  daily: { date: string; income: number; expenses: number }[];
  categories: { name: string; value: number }[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const totalSpending = categories.reduce((s, c) => s + c.value, 0);

  return (
    <div className="space-y-6">
      {/* Cash flow area chart */}
      <Card>
        <CardHeader>
          <CardTitle>Cash Flow</CardTitle>
          <CardDescription>Daily income vs expenses over time.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={cashFlowConfig} className="h-[350px] w-full">
            <AreaChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) =>
                  new Date(v).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v}`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) =>
                      formatCurrency(Number(value))
                    }
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="income"
                stackId="1"
                stroke="var(--color-income)"
                fill="var(--color-income)"
                fillOpacity={0.3}
              />
              <Area
                type="monotone"
                dataKey="expenses"
                stackId="1"
                stroke="var(--color-expenses)"
                fill="var(--color-expenses)"
                fillOpacity={0.3}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Top spending categories bar list */}
      <Card>
        <CardHeader>
          <CardTitle>Top Spending Categories</CardTitle>
          <CardDescription>Where your money is going.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {categories.slice(0, 8).map((cat, i) => {
            const pct =
              totalSpending > 0 ? (cat.value / totalSpending) * 100 : 0;
            return (
              <div key={cat.name} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{cat.name}</span>
                  <span className="font-mono text-muted-foreground">
                    {formatCurrency(cat.value)}
                  </span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: COLORS[i % COLORS.length],
                    }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories tab
// ---------------------------------------------------------------------------
function CategoriesTab({
  categories,
  isLoading,
}: {
  categories: { name: string; value: number }[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const total = categories.reduce((s, c) => s + c.value, 0);

  // Build dynamic chart config from category data
  const pieConfig = categories.reduce<ChartConfig>((acc, cat, i) => {
    acc[cat.name] = { label: cat.name, color: COLORS[i % COLORS.length] };
    return acc;
  }, {});

  const pieData = categories.map((c, i) => ({
    ...c,
    fill: COLORS[i % COLORS.length],
  }));

  return (
    <div className="space-y-6">
      {/* Donut chart */}
      <Card>
        <CardHeader>
          <CardTitle>Spending by Category</CardTitle>
          <CardDescription>
            Total: {formatCurrency(total)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={pieConfig} className="mx-auto h-[350px] w-full max-w-md">
            <PieChart>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) =>
                      formatCurrency(Number(value))
                    }
                  />
                }
              />
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={80}
                outerRadius={130}
                strokeWidth={2}
                stroke="var(--background)"
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Category table */}
      <Card>
        <CardHeader>
          <CardTitle>Category Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Category</th>
                  <th className="pb-2 text-right font-medium">Amount</th>
                  <th className="pb-2 text-right font-medium">% of Total</th>
                  <th className="pb-2 text-right font-medium">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {categories.map((cat, i) => {
                  const pct = total > 0 ? (cat.value / total) * 100 : 0;
                  // Mock trend: alternate for demonstration
                  const trend = i % 3 === 0 ? 5.2 : i % 3 === 1 ? -3.1 : 0;
                  return (
                    <tr key={cat.name}>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <div
                            className="size-2.5 rounded-full"
                            style={{
                              backgroundColor: COLORS[i % COLORS.length],
                            }}
                          />
                          <span className="font-medium">{cat.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        {formatCurrency(cat.value)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-muted-foreground">
                        {pct.toFixed(1)}%
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <TrendIcon value={trend} />
                          <span
                            className={cn(
                              "text-xs font-mono",
                              trend > 0 && "text-emerald-500",
                              trend < 0 && "text-red-500",
                              trend === 0 && "text-muted-foreground"
                            )}
                          >
                            {trend > 0 ? "+" : ""}
                            {trend}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trends tab
// ---------------------------------------------------------------------------
function TrendsTab() {
  return (
    <div className="space-y-6">
      {/* Monthly comparison grouped bar chart */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Comparison</CardTitle>
          <CardDescription>
            This month vs last month by category.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={monthlyCompareConfig} className="h-[350px] w-full">
            <BarChart data={MOCK_MONTHLY_COMPARE}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="category" tickLine={false} axisLine={false} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v}`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) =>
                      formatCurrency(Number(value))
                    }
                  />
                }
              />
              <Legend />
              <Bar
                dataKey="thisMonth"
                fill="var(--color-thisMonth)"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="lastMonth"
                fill="var(--color-lastMonth)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Net cash flow line chart */}
      <Card>
        <CardHeader>
          <CardTitle>Net Cash Flow</CardTitle>
          <CardDescription>
            Income minus expenses over recent months.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={netFlowConfig} className="h-[300px] w-full">
            <LineChart data={MOCK_NET_FLOW}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v}`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) =>
                      formatCurrency(Number(value))
                    }
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="net"
                stroke="var(--color-net)"
                strokeWidth={2}
                dot={{ r: 4, fill: "var(--color-net)" }}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget tab
// ---------------------------------------------------------------------------
function BudgetTab() {
  const totalSpent = MOCK_BUDGETS.reduce((s, b) => s + b.spent, 0);
  const totalBudget = MOCK_BUDGETS.reduce((s, b) => s + b.budget, 0);
  const overallUtil = Math.min((totalSpent / totalBudget) * 100, 100);

  return (
    <div className="space-y-6">
      {/* Overall budget */}
      <Card>
        <CardHeader>
          <CardTitle>Overall Budget Utilization</CardTitle>
          <CardDescription>
            {formatCurrency(totalSpent)} of {formatCurrency(totalBudget)} spent
            ({Math.round(overallUtil)}%)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={overallUtil}>
            <ProgressLabel>Total</ProgressLabel>
            <ProgressValue>{() => `${Math.round(overallUtil)}%`}</ProgressValue>
          </Progress>
        </CardContent>
      </Card>

      {/* Per-category progress */}
      <Card>
        <CardHeader>
          <CardTitle>Category Budgets</CardTitle>
          <CardDescription>
            Spending progress per category.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {MOCK_BUDGETS.map((item, i) => {
            const util = Math.min(
              (item.spent / item.budget) * 100,
              100
            );
            const isOver = item.spent > item.budget;

            return (
              <div key={item.category} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="size-2.5 rounded-full"
                      style={{
                        backgroundColor: COLORS[i % COLORS.length],
                      }}
                    />
                    <span className="font-medium">{item.category}</span>
                  </div>
                  <span
                    className={cn(
                      "font-mono text-xs",
                      isOver
                        ? "text-red-500"
                        : "text-muted-foreground"
                    )}
                  >
                    {formatCurrency(item.spent)} / {formatCurrency(item.budget)}
                  </span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      isOver ? "bg-red-500" : ""
                    )}
                    style={{
                      width: `${util}%`,
                      backgroundColor: isOver
                        ? undefined
                        : COLORS[i % COLORS.length],
                    }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Reports page
// ---------------------------------------------------------------------------
export default function ReportsPage() {
  const { data, isLoading } = useGetSummary();

  const daily = data?.daily ?? [];
  const categories = data?.categories ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">
          Visual breakdowns of your income, spending, and budgets.
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab
            daily={daily}
            categories={categories}
            isLoading={isLoading}
          />
        </TabsContent>

        <TabsContent value="categories">
          <CategoriesTab categories={categories} isLoading={isLoading} />
        </TabsContent>

        <TabsContent value="trends">
          <TrendsTab />
        </TabsContent>

        <TabsContent value="budget">
          <BudgetTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
