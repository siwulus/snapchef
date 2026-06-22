import { defineConfig, devices } from "@playwright/test";

// Playwright drives the real Astro dev server (against the staging `.env`).
// Specs live in `e2e/**/*.spec.ts` so they never collide with Vitest's
// `src/**/*.test.ts(x)` include glob.
//
// The dev server boots with `E2E_FAKE_LLM=true` (see `webServer.env`) so the paid
// OpenRouter adapters are swapped for deterministic fakes — E2E never hits the real API.
// Caveat: with `reuseExistingServer` on (local, non-CI), a `pnpm dev` you started yourself
// is reused as-is and will NOT have the flag — restart it (or let Playwright own the server)
// to get the fakes. CI always boots a fresh flagged server, so CI is unaffected.
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
    // Enable the fake LLM seam for the spawned dev server (Astro coerces the string).
    env: { E2E_FAKE_LLM: "true" },
  },
});
