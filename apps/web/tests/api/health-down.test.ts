import { expect, test } from "vitest";

// Fresh process per test file: the dead URL must land before the app's lazy
// pool first reads DATABASE_URL, and must not poison any other file.
process.env.DATABASE_URL = "postgresql://cashlens_app:wrong@127.0.0.1:9/cashlens";
const { GET } = await import("@/app/api/health/route");

test("health reports error when the database is unreachable", async () => {
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "error", db: "error" });
});
