"use client";

import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle } from "lucide-react";
import { useGetTransactions } from "@/features/transactions/api/use-get-transactions";
import { SwipeCard } from "@/components/review/swipe-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ReviewPage() {
  const { data: transactions, isLoading } = useGetTransactions({ limit: 500 });

  const unreviewed = transactions?.filter((t) => !t.reviewed) ?? [];
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => prev + 1);
  }, []);

  const handleApprove = useCallback(() => {
    // TODO: call mutation to mark transaction as reviewed + approved
    handleNext();
  }, [handleNext]);

  const handleReject = useCallback(() => {
    // TODO: call mutation to mark transaction as rejected
    handleNext();
  }, [handleNext]);

  const handleApproveAll = useCallback(() => {
    // TODO: call batch mutation to approve all remaining
    setCurrentIndex(unreviewed.length);
  }, [unreviewed.length]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex justify-center pt-8">
          <Skeleton className="h-64 w-full max-w-sm rounded-2xl" />
        </div>
      </div>
    );
  }

  const isDone = currentIndex >= unreviewed.length;
  const currentTransaction = unreviewed[currentIndex];
  const nextTransaction = unreviewed[currentIndex + 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review Queue</CardTitle>
        <CardDescription>
          {Math.min(currentIndex, unreviewed.length)} of {unreviewed.length}{" "}
          reviewed
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isDone || unreviewed.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <CheckCircle className="size-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">All caught up!</p>
              <p className="text-sm text-muted-foreground">
                No transactions to review right now.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-8">
            {/* Card stack */}
            <div className="relative w-full max-w-sm">
              {/* Next card peeking behind */}
              {nextTransaction && (
                <div className="absolute inset-0 top-2 -z-10 scale-[0.96] opacity-60">
                  <div className="h-full w-full rounded-2xl border bg-card shadow-md" />
                </div>
              )}

              {/* Active card */}
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={currentTransaction.id}
                  initial={{ scale: 0.95, opacity: 0, y: 10 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.9, opacity: 0, y: -20 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <SwipeCard
                    transaction={currentTransaction}
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Batch actions */}
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleNext}>
                Skip
              </Button>
              <Button onClick={handleApproveAll}>Approve All</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
