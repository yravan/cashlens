import { expect, test } from "@playwright/test";

test("a signed-out request to a protected page redirects to the sign-in page", async ({
  request,
  baseURL,
}) => {
  const response = await request.get("/", { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  const location = new URL(response.headers()["location"], baseURL);
  expect(location.pathname).toBe("/sign-in");
  expect(location.searchParams.get("redirect_url")).toBe(`${baseURL}/`);
});

test("a signed-out request to an unknown API path is redirected, not served", async ({
  request,
  baseURL,
}) => {
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

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(
    page.getByRole("button", { name: /continue with google/i }),
  ).toBeVisible();
  await expect(page.locator("input[type='password']")).toHaveCount(0);
});
