import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";

import {
  DatabaseQueryError,
  withPlaidItemScope,
  withRequestScope,
} from "@/lib/db/client";

const SENTINEL = "PRIVATE MERCHANT 9d6d60d7-68f3-44de-8900-bb3df335471c";

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
    cause: { code: "22P02", constraint: undefined },
  });

  const rendered = [
    String(error),
    (error as Error).stack,
    inspect(error, { depth: null, showHidden: true }),
    JSON.stringify(error),
  ].join("\n");
  expect(rendered).not.toContain(SENTINEL);
  expect(rendered).not.toContain("params:");
  expect(rendered).not.toContain("select $1::integer");
  expect(rendered).not.toContain("invalid input syntax");
}

test.each([
  ["request", (run: Parameters<typeof withRequestScope>[1]) => withRequestScope("db-error-user", run)],
  ["Plaid item", (run: Parameters<typeof withPlaidItemScope>[1]) => withPlaidItemScope("db-error-item", run)],
])("sanitizes real database failures at the %s scope", async (_name, scoped) => {
  const error = await rejection(scoped((tx) => tx.execute(sql`select ${SENTINEL}::integer`)));
  expectSanitized(error);
});

test.each([
  ["request", (run: Parameters<typeof withRequestScope>[1]) => withRequestScope("domain-error-user", run)],
  ["Plaid item", (run: Parameters<typeof withPlaidItemScope>[1]) => withPlaidItemScope("domain-error-item", run)],
])("preserves domain error identity at the %s scope", async (_name, scoped) => {
  const domainError = new TypeError("domain failure");
  const error = await rejection(scoped(async () => {
    throw domainError;
  }));
  expect(error).toBe(domainError);
});
