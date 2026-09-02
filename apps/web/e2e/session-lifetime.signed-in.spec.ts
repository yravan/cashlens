import fs from "node:fs";

import { STORAGE_STATE_A } from "../playwright.config";
import { expect, test } from "./fixtures";
import { savedRemainingMs, signedInState } from "./session";

// A dead 60-second __session leaves a state file that still carries every
// other cookie — which is why a stale suite looks fine until something reads
// the response body. Stripping the token reproduces that shape without
// waiting out a real token (the wall-clock proof lives in the PR).
function stripSessionToken(): string {
  const saved = fs.readFileSync(STORAGE_STATE_A, "utf8");
  const state = JSON.parse(saved);
  state.cookies = state.cookies.filter(
    (cookie: { name: string }) => !cookie.name.startsWith("__session"),
  );
  fs.writeFileSync(STORAGE_STATE_A, JSON.stringify(state, null, 2));
  return saved;
}

test("a request context built from a dead storage state is refreshed, not silently signed out", async ({
  browser,
  playwright,
  baseURL,
}) => {
  const backup = stripSessionToken();
  try {
    expect(savedRemainingMs("a")).toBe(0);

    // Negative control: this is what every APIRequestContext in the suite got
    // once the state aged past 60s. It cannot run clerk-js, so it follows the
    // handshake to the sign-in page and reports 200 with HTML — a request
    // that checks only status() reads that as success.
    const stale = await playwright.request.newContext({
      baseURL,
      storageState: STORAGE_STATE_A,
    });
    expect((await stale.get("/api/me", { maxRedirects: 0 })).status()).toBe(307);
    const bounced = await stale.get("/api/me");
    expect(bounced.status()).toBe(200);
    expect(bounced.headers()["content-type"]).toContain("text/html");
    await stale.dispose();

    const refreshed = await playwright.request.newContext({
      baseURL,
      storageState: await signedInState(browser, "a"),
    });
    const me = await refreshed.get("/api/me", { maxRedirects: 0 });
    expect(me.status()).toBe(200);
    expect(me.headers()["content-type"]).toContain("application/json");
    expect(await me.json()).toMatchObject({ id: expect.any(String) });
    await refreshed.dispose();

    expect(savedRemainingMs("a")).toBeGreaterThan(0);
  } catch (error) {
    fs.writeFileSync(STORAGE_STATE_A, backup);
    throw error;
  }
});
