import { expect, test } from "@playwright/test";

// Provenance
// ----------
// Risk: test-plan.md Risk #2 — "the critical end-to-end flow (upload → recognize →
//   edit → generate → save) has no browser-level proof; a wiring/prop break — e.g.
//   after the 2026-06-21 refactor that moved every recipe component — ships unseen."
// Seed exemplars: e2e/recipes-authenticated.spec.ts, e2e/public-access.spec.ts
//   (role-based locators, toHaveURL/waitForURL, no waitForTimeout, self-contained).
// Determinism: the dev server boots with E2E_FAKE_LLM=true (playwright.config.ts →
//   webServer.env), so both LLM boundaries are swapped for the fakes in
//   src/lib/infrastructure/llm/Fake{ProductRecognizer,RecipeGenerator}.ts. Storage
//   and DB stay REAL — that is where the integration risk this test protects lives.
//   The recognizer returns a canned list [Jajka, Mleko, Pomidory]; the generator
//   echoes the meal context into the recipe name ("Przepis (atrapa E2E): <context>").
//   That echo is the oracle: it can only be correct if the typed edit survived every
//   handoff between the three wizard steps and the final save → SSR readback.
// Auth: seeded once by the `setup` project (auth.setup.ts → e2e/.auth/user.json) and
//   loaded via the `authenticated` project's storageState — no UI login here.

test.describe("critical recipe flow (authenticated)", () => {
  // The flow creates a real session (DB row + a real photo in Supabase storage) and,
  // on success, a saved recipe. afterEach hard-deletes it by session id (cascade:
  // storage + DB) so the test is repeatable and parallel-safe even after a failure.
  let createdSessionId: string | null = null;

  test.afterEach(async ({ request }) => {
    if (createdSessionId) {
      // The same endpoint the Delete control hits; the `request` fixture carries the
      // authenticated storageState. Best-effort cleanup — don't fail the run on teardown.
      await request.delete(`/api/recipe-sessions/${createdSessionId}`).catch(() => undefined);
      createdSessionId = null;
    }
  });

  test("upload → recognize → edit context → generate → save persists the recipe end to end", async ({ page }) => {
    // A unique meal context per run: it both identifies this run's recipe (so the
    // readback assertion can't match a leftover) and is the value the generator echoes
    // into the recipe name — the oracle that the edit flowed through the whole flow.
    const mealContext = `Kolacja E2E ${Date.now()}`;
    const expectedRecipeName = `Przepis (atrapa E2E): ${mealContext}`;

    // Step — start the wizard. Authenticated → the middleware guard admits us; we land
    // on /recipes/new (NOT bounced to /auth/signin) and the upload step is mounted.
    await page.goto("/recipes/new");
    await expect(page).toHaveURL(/\/recipes\/new$/);
    // RecipeWizard is a client:load island; in dev the browser must fetch + run its JS
    // before its onClick/onChange handlers exist. Wait for the island scripts to settle
    // so the upload trigger is interactive — otherwise a click lands before hydration
    // and is silently lost (not a fixed timeout: it resolves as soon as the page is idle).
    await page.waitForLoadState("networkidle");
    const recognizeButton = page.getByRole("button", { name: "Rozpoznaj produkty" });
    await expect(recognizeButton).toBeVisible();

    // Step — pick a photo and trigger recognition. The file <input> is visually hidden
    // (sr-only) and fronted by the "Wybierz zdjęcia" trigger button, so drive the real
    // file chooser the user does: clicking the trigger calls inputRef.click(), and the
    // resulting native change event fires the React handler that registers the photo.
    // (Setting files directly on the hidden input updates the DOM but does NOT trip
    // React's onChange here, so the upload would never arm.)
    // `exact: true` is required: the hidden <input type="file"> has an implicit ARIA
    // role of button too (name "Wybierz zdjęcia produktów"), which a substring match
    // would also catch — exact pins the visible trigger button only.
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Wybierz zdjęcia", exact: true }).click();
    await (await fileChooserPromise).setFiles("e2e/fixtures/groceries.png");
    await expect(recognizeButton).toBeEnabled();
    await recognizeButton.click();

    // Step — the review screen renders once recognition (real upload → fake recognizer)
    // completes. The "Lista zbiorcza" card title proves the recognition→review handoff
    // worked (it is a shadcn CardTitle <div>, not a heading element, so match by text);
    // the three name inputs prove the recognized items reached the editor in order
    // ([Jajka, Mleko, Pomidory]). Web-first assertions auto-retry — no fixed wait.
    await expect(page.getByText("Lista zbiorcza")).toBeVisible();
    const productNames = page.getByRole("textbox", { name: "Nazwa produktu" });
    await expect(productNames).toHaveCount(3);
    await expect(productNames.first()).toHaveValue("Jajka");

    // Step — edit: enter the meal context, then generate. This is the user edit whose
    // survival across the review→recipe handoff Risk #2 cares about.
    await page.getByLabel("Co chcesz ugotować?").fill(mealContext);
    await page.getByRole("button", { name: "Generuj przepis" }).click();

    // Step — the recipe step renders. "Zapisz przepis" is unique to this step (it only
    // appears once a recipe exists), so its visibility proves the generation handoff
    // wired the recipe back into the wizard. Then persist.
    const saveButton = page.getByRole("button", { name: "Zapisz przepis" });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // Step — save redirects to the saved-recipe detail page (/recipes/<uuid>).
    await page.waitForURL(/\/recipes\/[0-9a-f-]{36}$/);
    createdSessionId = new URL(page.url()).pathname.split("/").pop() ?? null;
    expect(createdSessionId).not.toBeNull();

    // Step — readback (the business outcome). The detail page SSRs the persisted recipe.
    // Its h1 carries the generator's echo of the typed meal context — proof the edit
    // survived upload → recognize → review → generate → save → reload. The recognized
    // "Jajka" appearing in the persisted body proves the recognition leg reached storage
    // too. If any handoff between steps breaks, this readback fails.
    await expect(page.getByRole("heading", { name: expectedRecipeName, level: 1 })).toBeVisible();
    await expect(page.getByText("Jajka").first()).toBeVisible();
  });
});
