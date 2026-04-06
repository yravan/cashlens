"use client";

import { useState } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { type Transaction } from "@/features/transactions/api/use-get-transactions";
import { formatDate } from "@/lib/utils";

const CATEGORIES = [
  { label: "Food", emoji: "\ud83c\udf54" },
  { label: "Transport", emoji: "\ud83d\ude97" },
  { label: "Groceries", emoji: "\ud83d\uded2" },
  { label: "Housing", emoji: "\ud83c\udfe0" },
  { label: "Health", emoji: "\ud83d\udc8a" },
  { label: "Entertainment", emoji: "\ud83c\udfae" },
  { label: "Travel", emoji: "\u2708\ufe0f" },
  { label: "Income", emoji: "\ud83d\udcb0" },
  { label: "Shopping", emoji: "\ud83d\udce6" },
  { label: "Other", emoji: "\u2753" },
] as const;

const SWIPE_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 500;

interface SwipeCardProps {
  transaction: Transaction;
  confidence?: number;
  onApprove: () => void;
  onReject: () => void;
}

export function SwipeCard({
  transaction,
  confidence = 85,
  onApprove,
  onReject,
}: SwipeCardProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    transaction.category
  );

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-8, 0, 8]);
  const opacity = useTransform(x, [-200, -100, 0, 100, 200], [0.5, 0.8, 1, 0.8, 0.5]);
  const bgColor = useTransform(
    x,
    [-200, -50, 0, 50, 200],
    [
      "rgba(239,68,68,0.15)",
      "rgba(239,68,68,0.05)",
      "rgba(255,255,255,0)",
      "rgba(34,197,94,0.05)",
      "rgba(34,197,94,0.15)",
    ]
  );

  function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const offsetX = info.offset.x;
    const velocityX = info.velocity.x;

    if (offsetX > SWIPE_THRESHOLD || velocityX > VELOCITY_THRESHOLD) {
      onApprove();
    } else if (offsetX < -SWIPE_THRESHOLD || velocityX < -VELOCITY_THRESHOLD) {
      onReject();
    }
  }

  const amount = parseFloat(transaction.amount);
  const isIncome = amount < 0;
  const displayAmount = Math.abs(amount);
  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(displayAmount);

  const confidenceBadgeClass =
    confidence >= 90
      ? "border-emerald-500 text-emerald-700 dark:text-emerald-400"
      : confidence >= 70
        ? "border-amber-500 text-amber-700 dark:text-amber-400"
        : "border-red-500 text-red-700 dark:text-red-400";

  return (
    <div className="flex flex-col items-center gap-6">
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDragEnd={handleDragEnd}
        style={{ x, rotate, opacity, backgroundColor: bgColor }}
        className="w-full max-w-sm cursor-grab rounded-2xl border bg-card p-6 shadow-lg active:cursor-grabbing"
      >
        {/* Swipe indicators */}
        <div className="pointer-events-none mb-4 flex items-center justify-between">
          <motion.span
            style={{ opacity: useTransform(x, [-150, -50], [1, 0]) }}
            className="text-sm font-medium text-red-500"
          >
            REJECT
          </motion.span>
          <motion.span
            style={{ opacity: useTransform(x, [50, 150], [0, 1]) }}
            className="text-sm font-medium text-emerald-500"
          >
            APPROVE
          </motion.span>
        </div>

        {/* Transaction info */}
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold">
                {transaction.merchant_name || transaction.description}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatDate(transaction.date)}
              </p>
            </div>
            <p
              className={`shrink-0 font-mono text-xl font-bold ${
                isIncome
                  ? "text-emerald-600 dark:text-emerald-400"
                  : ""
              }`}
            >
              {isIncome ? "+" : "-"}
              {formattedAmount}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {selectedCategory && (
              <Badge variant="outline">{selectedCategory}</Badge>
            )}
            <Badge variant="outline" className={confidenceBadgeClass}>
              {confidence}% confidence
            </Badge>
          </div>
        </div>
      </motion.div>

      {/* Category quick-pick pills */}
      <div className="w-full max-w-sm">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Category
        </p>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.label;
            return (
              <button
                key={cat.label}
                onClick={() => setSelectedCategory(cat.label)}
                className="shrink-0"
              >
                <Badge variant={isSelected ? "default" : "outline"}>
                  {cat.emoji} {cat.label}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
