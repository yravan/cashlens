import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";

const SENTINEL = "PRIVATE TIMEOUT MERCHANT 4fa48bd8-f143-40a2-83d2-70f0f15de091";
const databaseUrl = new URL(process.env.DATABASE_URL!);
databaseUrl.searchParams.set("query_timeout", "250");
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
  expect(error).toBeInstanceOf(DatabaseQueryError);
  expect(error).toMatchObject({
    message: "Database query failed",
    cause: { code: undefined, constraint: undefined },
  });
}

test("sanitizes client-side query timeouts at both database scopes", async () => {
  const query = async (tx: Parameters<Parameters<typeof withRequestScope>[1]>[0]) => {
    let timeout: unknown;
    try {
      await tx.execute(sql`select ${SENTINEL}::text, pg_sleep(0.3)`);
    } catch (error) {
      timeout = error;
    }
    await tx.execute(sql`select 1`);
    throw timeout;
  };

  expectSanitized(await rejection(withRequestScope("timeout-user", query)));
  expectSanitized(await rejection(withPlaidItemScope("timeout-item", query)));
});
