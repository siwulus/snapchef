import { defineConfig, devices } from "@playwright/test";

// Playwright drives the real Astro dev server (against the staging `.env`).
// Specs live in `e2e/**/*.spec.ts` so they never collide with Vitest's
// `src/**/*.test.ts(x)` include glob.
const PORT = 4321;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Programmatic sign-in → e2e/.auth/user.json. Skips gracefully when the
    // E2E_USER_* credentials are absent (see e2e/auth.setup.ts).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Logged-out specs: explicit empty storage state, no auth dependency.
    {
      name: "public",
      testMatch: "**/public-access.spec.ts",
      use: { ...devices["Desktop Chrome"], storageState: { cookies: [], origins: [] } },
    },
    // Authenticated specs (none yet): start logged-in from the saved session.
    {
      name: "authenticated",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
      testIgnore: "**/public-access.spec.ts",
    },
  ],
  webServer: {
    command: "pnpm dev --port 4321",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
