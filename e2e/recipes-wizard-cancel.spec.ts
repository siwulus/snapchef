import { expect, test } from "@playwright/test";

// Provenance
// ----------
// Risk: test-plan.md Risk #1 (delete facet) — "save/delete acts on a missing or
//   foreign session ... returns a typed NotFound and performs no write." This is the
//   UI-floor complement to that risk: the wizard's "Anuluj" (cancel) path must run the
//   confirm dialog → DELETE → DB cascade → redirect, and the delete must actually
//   remove the row (the deeper ownership/foreign-session logic is unit/integration's job).
//   Sibling e2e/recipes-wizard.spec.ts (Risk #2) covers the SAVE path; this covers cancel.
// Seed exemplar: e2e/recipes-wizard.spec.ts (role/label/text locators, networkidle
//   hydration wait, file-chooser upload, no waitForTimeout, self-contained + cleanup).
// Determinism: dev server boots with E2E_FAKE_LLM=true so recognition is the deterministic
//   fake — storage + DB stay REAL, which is where the delete's write actually matters.
// Auth: seeded by the `setup` project (auth.setup.ts → e2e/.auth/user.json), loaded via
//   the `authenticated` project's storageState — no UI login here.

test.describe("recipe wizard cancel/delete (authenticated)", () => {
  // The flow creates a real session (DB row + a real photo in storage). The happy path
  // deletes it via the UI; afterEach is a safety net (best-effort) in case an assertion
  // fails before the cancel completes, so the run stays repeatable and parallel-safe.
  let createdSessionId: string | null = null;

  // Cleanup runs in the browser (page.evaluate → fetch), not via the request fixture: a
  // same-origin browser fetch carries the Origin header Astro's CSRF guard requires for a
  // DELETE, whereas an APIRequestContext DELETE is rejected 403 "cross-site" and would
  // silently leak the row.
  test.afterEach(async ({ page }) => {
    if (!createdSessionId) return;
    const id = createdSessionId;
    createdSessionId = null;
    await page
      .evaluate((sessionId) => fetch(`/api/recipe-sessions/${sessionId}`, { method: "DELETE" }), id)
      .catch(() => undefined);
  });

  test("cancelling the wizard deletes the session and returns to the catalog", async ({ page }) => {
    // Step — start the wizard (authenticated → admitted, not bounced to /auth/signin) and
    // wait for the client:load island to hydrate before driving it.
    await page.goto("/recipes/new");
    await expect(page).toHaveURL(/\/recipes\/new$/);
    await page.waitForLoadState("networkidle");

    // Step — upload a photo via the real file chooser (the hidden <input> is fronted by
    // the "Wybierz zdjęcia" trigger; exact pins it past the input's implicit button role),
    // then recognise. Capturing the create-session response gives us the session id, which
    // is held only in React state during the wizard (it never appears in the URL pre-save).
    const recognizeButton = page.getByRole("button", { name: "Rozpoznaj produkty" });
    await expect(recognizeButton).toBeVisible();

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Wybierz zdjęcia", exact: true }).click();
    await (await fileChooserPromise).setFiles("e2e/fixtures/groceries.png");
    await expect(recognizeButton).toBeEnabled();

    const createResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().endsWith("/api/recipe-sessions"),
    );
    await recognizeButton.click();
    const created = (await (await createResponsePromise).json()) as { ok: boolean; data?: { id: string } };
    const sessionId = created.data?.id;
    if (!sessionId) throw new Error("create-session response carried no id");
    createdSessionId = sessionId;

    // Step — the review screen renders (session now exists, so the action row with "Anuluj"
    // is present). "Lista zbiorcza" is the review-step marker.
    await expect(page.getByText("Lista zbiorcza")).toBeVisible();

    // Step — cancel: open the confirm dialog and confirm the destructive delete.
    await page.getByRole("button", { name: "Anuluj" }).click();
    const confirmDelete = page.getByRole("button", { name: "Usuń" });
    await expect(confirmDelete).toBeVisible();
    await confirmDelete.click();

    // Step — the delete redirects back to the catalog.
    await page.waitForURL(/\/recipes$/);
    await expect(page).toHaveURL(/\/recipes$/);

    // Step — the business outcome: the session was genuinely removed (the delete performed
    // a write), and a delete on the now-missing session fails closed with 404 NotFound.
    // A follow-up DELETE to the same id proves both at once — if the cancel had only
    // navigated without deleting, this would return 200 instead of 404. The DELETE is
    // issued via a same-origin browser fetch (page.evaluate) so it carries the Origin
    // header Astro's CSRF guard requires — exactly how the app's own delete reaches it.
    const recheckStatus = await page.evaluate(
      (id) => fetch(`/api/recipe-sessions/${id}`, { method: "DELETE" }).then((response) => response.status),
      sessionId,
    );
    expect(recheckStatus).toBe(404);
    createdSessionId = null; // confirmed gone — afterEach has nothing to clean up
  });
});
