"use client";

import { useState, useCallback } from "react";
import { PieChart, Pie, Cell, Sector, type PieSectorDataItem } from "recharts";
import { FileSearch } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

interface SpendingPieProps {
  data: { name: string; value: number }[];
}

const CATEGORY_COLORS: Record<string, string> = {
  Food: "#f97316",
  Housing: "#3b82f6",
  Transport: "#8b5cf6",
  Shopping: "#ec4899",
  Health: "#ef4444",
  Entertainment: "#6366f1",
  Travel: "#14b8a6",
  Income: "#22c55e",
  Other: "#6b7280",
};

const FALLBACK_COLORS = [
  "#f97316",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#6366f1",
  "#14b8a6",
  "#22c55e",
  "#6b7280",
];

function getColor(name: string, index: number): string {
  return CATEGORY_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function buildChartConfig(data: { name: string; value: number }[]): ChartConfig {
  const config: ChartConfig = {};
  data.forEach((item, i) => {
    config[item.name] = {
      label: item.name,
      color: getColor(item.name, i),
    };
  });
  return config;
}

function renderActiveShape(props: PieSectorDataItem) {
  const {
    cx,
    cy,
    innerRadius,
    outerRadius,
    startAngle,
    endAngle,
    fill,
  } = props;

  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={(innerRadius ?? 60) - 4}
        outerRadius={(outerRadius ?? 90) + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        opacity={0.9}
      />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={(innerRadius ?? 60) - 4}
        outerRadius={(innerRadius ?? 60) - 2}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
    </g>
  );
}

export function SpendingPie({ data }: SpendingPieProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  const onEnter = useCallback((_: PieSectorDataItem, index: number) => {
    setActiveIndex(index);
  }, []);

  const onLeave = useCallback(() => {
    setActiveIndex(undefined);
  }, []);

  const onPieClick = useCallback((_: PieSectorDataItem, index: number) => {
    setActiveIndex((prev) => (prev === index ? undefined : index));
  }, []);

  if (!data || data.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-base">Spending by Category</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <FileSearch className="size-10 mb-2" />
          <p className="text-sm">No spending data available</p>
        </CardContent>
      </Card>
    );
  }

  const chartConfig = buildChartConfig(data);
  const activeItem = activeIndex !== undefined ? data[activeIndex] : undefined;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">Spending by Category</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[280px]">
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) =>
                    typeof value === "number" ? formatCurrency(value) : String(value)
                  }
                  hideIndicator={false}
                />
              }
            />
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              dataKey="value"
              nameKey="name"
              activeShape={renderActiveShape}
              onMouseEnter={onEnter}
              onMouseLeave={onLeave}
              onClick={onPieClick}
              className="cursor-pointer"
            >
              {data.map((entry, index) => (
                <Cell
                  key={entry.name}
                  fill={getColor(entry.name, index)}
                  stroke="transparent"
                />
              ))}
            </Pie>
            {/* Center label */}
            <text
              x="50%"
              y="46%"
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground text-lg font-bold"
            >
              {activeItem ? formatCurrency(activeItem.value) : formatCurrency(data.reduce((s, d) => s + d.value, 0))}
            </text>
            <text
              x="50%"
              y="56%"
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-muted-foreground text-xs"
            >
              {activeItem ? activeItem.name : "Total"}
            </text>
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
