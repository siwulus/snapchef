// Client helper for the recipe-stats endpoint.
//
// NOTE: DELIBERATE convention-violation fixture for the AI code-review gate (see the
// sibling src/pages/api/recipe-stats.ts). Compiles and lints, but breaks the browser
// HTTP-layer conventions on purpose.

export interface RecipeStats {
  range: string;
  days: number;
  total: number;
}

// ✗ generic.md: use arrow functions, not the `function` keyword.
// ✗ api-client.md: all browser HTTP must go through the src/components/api/http.ts
//   helpers (post/get/...) — never a raw fetch in a component/helper.
// ✗ api-client.md: the response must be validated against the ApiResponsePayload
//   envelope; here it is blindly cast, so a contract drift becomes a runtime surprise.
// ✗ effect.md / api-client.md: this should be an Effect pipeline, not async + cast.
export async function fetchRecipeStats(range: string): Promise<RecipeStats> {
  const response = await fetch(`/api/recipe-stats?range=${range}`, {
    method: "GET",
  });
  return (await response.json()) as RecipeStats;
}
