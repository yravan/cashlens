import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";

const SENTINEL = "PRIVATE TIMEOUT MERCHANT 4fa48bd8-f143-40a2-83d2-70f0f15de091";
const databaseUrl = new URL(process.env.DATABASE_URL!);
databaseUrl.searchParams.set("query_timeout", "50");
process.env.DATABASE_URL = databaseUrl.href;

const {
  DatabaseQueryError,
  withPlaidItemScope,
  withRequestScope,
} = await import("@/lib/db/client");

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected database operation to reject");
}

function expectSanitized(error: unknown): void {
  expect(error).toBeInstanceOf(DatabaseQueryError);
  expect(error).toMatchObject({
    message: "Database query failed",
    cause: { code: undefined, constraint: undefined },
  });
  const rendered = [
    String(error),
    (error as Error).stack,
    inspect(error, { depth: null, showHidden: true }),
    JSON.stringify(error),
  ].join("\n");
  expect(rendered).not.toContain(SENTINEL);
  expect(rendered).not.toContain("params:");
  expect(rendered).not.toContain("pg_sleep");
  expect(rendered).not.toContain("Query read timeout");
}

test("sanitizes client-side query timeouts at both database scopes", async () => {
  const query = (tx: Parameters<Parameters<typeof withRequestScope>[1]>[0]) =>
    tx.execute(sql`select ${SENTINEL}::text, pg_sleep(0.25)`);
  const [requestError, itemError] = await Promise.all([
    rejection(withRequestScope("timeout-user", query)),
    rejection(withPlaidItemScope("timeout-item", query)),
  ]);
  expectSanitized(requestError);
  expectSanitized(itemError);
});
