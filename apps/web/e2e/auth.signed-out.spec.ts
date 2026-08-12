import { expect, test } from "@playwright/test";

// Leaf 1.1.1 promise: signed-out visitors land on a login page.
// These tests carry no session state (no storageState).

test("a signed-out request to a protected page redirects to the sign-in page", async ({
  request,
  baseURL,
}) => {
  const response = await request.get("/", { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  const location = new URL(response.headers()["location"], baseURL);
  expect(location.pathname).toBe("/sign-in");
  // The original destination is preserved so sign-in can return the visitor.
  expect(location.searchParams.get("redirect_url")).toBe(`${baseURL}/`);
});

test("a signed-out request to an unknown API path is redirected, not served", async ({
  request,
  baseURL,
}) => {
  // Protect-by-default: even routes that do not exist yet are gated.
  const response = await request.get("/api/anything", { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  const location = new URL(response.headers()["location"], baseURL);
  expect(location.pathname).toBe("/sign-in");
  expect(location.searchParams.get("redirect_url")).toBe(
    `${baseURL}/api/anything`,
  );
});

test("a signed-out browser visit lands on the login page showing the Google sign-in affordance", async ({
  page,
}) => {
  await page.goto("/");

  // Dev instances hop through Clerk's handshake redirect first; the visitor
  // must still end up on our own /sign-in page.
  await expect(page).toHaveURL(/\/sign-in/);

  // The one way in: Google. Rendered by Clerk's <SignIn /> after hydration.
  await expect(
    page.getByRole("button", { name: /continue with google/i }),
  ).toBeVisible();

  // Google-only instance: there must be no password credential field.
  await expect(page.locator("input[type='password']")).toHaveCount(0);
});
