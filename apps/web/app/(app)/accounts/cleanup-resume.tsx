"use client";

import { useEffect } from "react";

import {
  CONNECTION_CLEANUP_BATCH_SIZE,
  CONNECTION_CLEANUP_LEASE_MS,
  CONNECTION_CLEANUP_MAX_ATTEMPTS,
} from "@/lib/connection-cleanup-policy";

const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
    : 0;
}

function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (completed: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      resolve(completed);
    };
    const aborted = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

async function resumeOne(connectionId: string, signal: AbortSignal): Promise<void> {
  for (let attempt = 0; attempt < CONNECTION_CLEANUP_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`/api/connections/${connectionId}/cleanup`, {
        method: "POST",
        signal,
      });
    } catch {
      if (signal.aborted || attempt + 1 === CONNECTION_CLEANUP_MAX_ATTEMPTS) return;
      if (!(await pause(CONNECTION_CLEANUP_LEASE_MS, signal))) return;
      continue;
    }
    if (response.ok || (response.status !== 429 && response.status < 500)) return;
    if (attempt + 1 === CONNECTION_CLEANUP_MAX_ATTEMPTS) return;
    const delay = Math.max(CONNECTION_CLEANUP_LEASE_MS, retryAfterMs(response));
    if (!(await pause(delay, signal))) return;
  }
}

export function CleanupResume({ connectionIds }: { connectionIds: string[] }) {
  const key = connectionIds.slice(0, CONNECTION_CLEANUP_BATCH_SIZE).join(",");

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void Promise.allSettled(
      key.split(",").map((connectionId) => resumeOne(connectionId, controller.signal)),
    );
    return () => controller.abort();
  }, [key]);

  return null;
}
