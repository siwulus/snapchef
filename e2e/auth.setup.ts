import { expect, test as setup } from "@playwright/test";

// Programmatic session seeding for authenticated specs. POSTing to the app's
// own sign-in endpoint sets the real @supabase/ssr cookies; saving the request
// storage state captures them — no UI interaction, no dedicated login test.
//
// Requires a pre-confirmed staging account, with credentials in `.env`:
//   E2E_USER_EMAIL / E2E_USER_PASSWORD
// Absent those, this skips so the logged-out suite still runs unblocked.
const authFile = "e2e/.auth/user.json";

setup("authenticate", async ({ request }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  if (!email || !password) {
    setup.skip(true, "Set E2E_USER_EMAIL / E2E_USER_PASSWORD to seed an authenticated session.");
    return;
  }

  const response = await request.post("/api/auth/signin", { data: { email, password } });
  expect(response.ok()).toBeTruthy();

  await request.storageState({ path: authFile });
});
