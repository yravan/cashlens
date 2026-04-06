"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { FileSearch } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

interface CashFlowChartProps {
  data: { date: string; income: number; expenses: number }[];
}

type ChartType = "area" | "bar" | "line";

const chartConfig: ChartConfig = {
  income: {
    label: "Income",
    color: "#3b82f6",
  },
  expenses: {
    label: "Expenses",
    color: "#f43f5e",
  },
};

function formatXAxis(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM dd");
  } catch {
    return dateStr;
  }
}

function CustomTooltipContent(props: React.ComponentProps<typeof ChartTooltipContent>) {
  return (
    <ChartTooltipContent
      {...props}
      labelFormatter={(_, payload) => {
        if (payload?.[0]?.payload?.date) {
          try {
            return format(parseISO(payload[0].payload.date), "MMM dd, yyyy");
          } catch {
            return String(payload[0].payload.date);
          }
        }
        return String(props.label ?? "");
      }}
      formatter={(value) =>
        typeof value === "number" ? formatCurrency(value) : String(value)
      }
    />
  );
}

function AreaVariant({
  data,
}: {
  data: { date: string; income: number; expenses: number }[];
}) {
  return (
    <AreaChart data={data} accessibilityLayer>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="date"
        tickFormatter={formatXAxis}
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        fontSize={12}
      />
      <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
      <ChartTooltip content={<CustomTooltipContent />} />
      <defs>
        <linearGradient id="fillIncome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="var(--color-income)" stopOpacity={0.3} />
          <stop offset="95%" stopColor="var(--color-income)" stopOpacity={0.02} />
        </linearGradient>
        <linearGradient id="fillExpenses" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="var(--color-expenses)" stopOpacity={0.3} />
          <stop offset="95%" stopColor="var(--color-expenses)" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <Area
        type="monotone"
        dataKey="income"
        stackId="1"
        stroke="var(--color-income)"
        fill="url(#fillIncome)"
        strokeWidth={2}
      />
      <Area
        type="monotone"
        dataKey="expenses"
        stackId="2"
        stroke="var(--color-expenses)"
        fill="url(#fillExpenses)"
        strokeWidth={2}
      />
    </AreaChart>
  );
}

function BarVariant({
  data,
}: {
  data: { date: string; income: number; expenses: number }[];
}) {
  return (
    <BarChart data={data} accessibilityLayer>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="date"
        tickFormatter={formatXAxis}
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        fontSize={12}
      />
      <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
      <ChartTooltip content={<CustomTooltipContent />} />
      <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} />
      <Bar
        dataKey="expenses"
        fill="var(--color-expenses)"
        radius={[4, 4, 0, 0]}
      />
    </BarChart>
  );
}

function LineVariant({
  data,
}: {
  data: { date: string; income: number; expenses: number }[];
}) {
  return (
    <LineChart data={data} accessibilityLayer>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="date"
        tickFormatter={formatXAxis}
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        fontSize={12}
      />
      <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
      <ChartTooltip content={<CustomTooltipContent />} />
      <Line
        type="monotone"
        dataKey="income"
        stroke="var(--color-income)"
        strokeWidth={2}
        dot={false}
      />
      <Line
        type="monotone"
        dataKey="expenses"
        stroke="var(--color-expenses)"
        strokeWidth={2}
        dot={false}
      />
    </LineChart>
  );
}

export function CashFlowChart({ data }: CashFlowChartProps) {
  const [chartType, setChartType] = useState<ChartType>("area");

  if (!data || data.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-base">Cash Flow</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <FileSearch className="size-10 mb-2" />
          <p className="text-sm">No transaction data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Cash Flow</CardTitle>
        <Select value={chartType} onValueChange={(v) => setChartType(v as ChartType)}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="area">Area</SelectItem>
            <SelectItem value="bar">Bar</SelectItem>
            <SelectItem value="line">Line</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
          {chartType === "area" && <AreaVariant data={data} />}
          {chartType === "bar" && <BarVariant data={data} />}
          {chartType === "line" && <LineVariant data={data} />}
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
