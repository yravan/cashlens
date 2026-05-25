import { format } from "date-fns";
import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(value: string | null) {
  if (!value) return "Not available";
  return format(new Date(value), "MMM d, yyyy");
}

export function formatDateTime(value: string | null) {
  if (!value) return "Not available";
  return format(new Date(value), "MMM d, yyyy 'at' h:mm a");
}
