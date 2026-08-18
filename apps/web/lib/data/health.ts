import "server-only";

import { pingDb } from "@/lib/db/client";

export async function databaseHealthy(): Promise<boolean> {
  try {
    await pingDb();
    return true;
  } catch {
    return false;
  }
}
