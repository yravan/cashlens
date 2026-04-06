"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { type Transaction } from "@/features/transactions/api/use-get-transactions";
import { formatDate } from "@/lib/utils";

export const columns: ColumnDef<Transaction>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected()}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatDate(row.getValue("date"))}
      </span>
    ),
    sortingFn: (rowA, rowB) => {
      const a = rowA.getValue<string>("date");
      const b = rowB.getValue<string>("date");
      return a < b ? -1 : a > b ? 1 : 0;
    },
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => {
      const merchant = row.original.merchant_name;
      const description = row.getValue<string>("description");
      return (
        <span className="max-w-[280px] truncate font-medium">
          {merchant || description}
        </span>
      );
    },
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => {
      const category = row.getValue<string | null>("category");
      if (!category) return <span className="text-muted-foreground">--</span>;
      return <Badge variant="outline">{category}</Badge>;
    },
  },
  {
    accessorKey: "amount",
    header: () => <div className="text-right">Amount</div>,
    cell: ({ row }) => {
      const raw = parseFloat(row.getValue("amount"));
      const isIncome = raw < 0;
      const display = Math.abs(raw);
      const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      }).format(display);

      return (
        <div
          className={`text-right font-mono text-sm ${
            isIncome ? "text-emerald-600 dark:text-emerald-400" : ""
          }`}
        >
          {isIncome ? "+" : "-"}
          {formatted}
        </div>
      );
    },
    sortingFn: (rowA, rowB) => {
      const a = parseFloat(rowA.getValue("amount"));
      const b = parseFloat(rowB.getValue("amount"));
      return a - b;
    },
  },
];
