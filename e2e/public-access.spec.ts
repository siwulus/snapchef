import { expect, test } from "@playwright/test";

// First e2e: an unauthenticated visitor. No auth, no seeding, no LLM.
test.describe("public access (logged out)", () => {
  test("landing page renders for an unauthenticated visitor", async ({ page }) => {
    await page.goto("/");

    // No redirect away from the public landing page.
    await expect(page).toHaveURL(/\/$/);
    // The page actually rendered its entry points.
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /get started/i })).toBeVisible();
  });

  test("protected catalog redirects an unauthenticated visitor to sign in", async ({ page }) => {
    await page.goto("/recipes");

    // Middleware (PROTECTED_ROUTES) sends logged-out users to /auth/signin.
    await expect(page).toHaveURL(/\/auth\/signin/);
  });
});
