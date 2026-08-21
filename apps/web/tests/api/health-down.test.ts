import { expect, test } from "vitest";

// Own file, so own process: the dead URL must beat the app's lazy pool to DATABASE_URL, and poison no other test.
process.env.DATABASE_URL = "postgresql://cashlens_app:wrong@127.0.0.1:9/cashlens";
const { GET } = await import("@/app/api/health/route");

test("health reports error when the database is unreachable", async () => {
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "error", db: "error" });
});
