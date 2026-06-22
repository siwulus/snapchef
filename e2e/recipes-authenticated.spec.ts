import { expect, test } from "@playwright/test";

// Authenticated happy-path. The session is seeded once by the `setup` project
// (e2e/auth.setup.ts → e2e/.auth/user.json) and loaded via the `authenticated`
// project's storageState — so there is deliberately NO login flow in this test.
test.describe("recipes catalog (authenticated)", () => {
  test("an authenticated user can see the recipes page", async ({ page }) => {
    await page.goto("/recipes");

    // Authenticated → the middleware guard admits us; we are NOT bounced to /auth/signin.
    await expect(page).toHaveURL(/\/recipes$/);
    // The catalog actually rendered. The "Twoje przepisy" header sits above the
    // error/empty/list branches, so it is present regardless of the test user's data.
    await expect(page.getByRole("heading", { name: "Twoje przepisy" })).toBeVisible();
  });
});
