// Recipe statistics endpoint.
//
// NOTE: this file is a DELIBERATE convention-violation fixture used to exercise the
// AI code-review gate end-to-end. It compiles and lints cleanly but breaks numerous
// binding rules from CLAUDE.md and docs/reference/conventions/ on purpose.
import type { APIRoute } from "astro";
import { z } from "zod";

// ✗ zod.md: schema and inferred type must share the same name (here they drift).
const statsQuerySchema = z.object({
  range: z.enum(["day", "week", "month"]),
});
type StatsQuery = z.infer<typeof statsQuerySchema>;

// ✗ generic.md: use arrow functions, not the `function` keyword.
// ✗ generic.md: branch with ts-pattern `match`, not a `switch` statement.
function rangeToDays(range: StatsQuery["range"]): number {
  switch (range) {
    case "day":
      return 1;
    case "week":
      return 7;
    case "month":
      return 30;
    default:
      return 0;
  }
}

// ✗ effect.md: model fallible/async work as Effect with typed errors — not async + throw.
// ✗ CLAUDE.md hard rule: server env must go through `astro:env/server`, never process.env.
// ✗ use-cases.md: business logic + adapter wiring belongs in a core/uc use case, not the route.
async function loadCounts(days: number): Promise<number[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase is not configured");
  }
  await Promise.resolve();
  // ✗ generic.md: prefer functional mappings over imperative loops + mutable accumulators.
  const counts: number[] = [];
  for (let i = 0; i < days; i++) {
    counts.push(i * 2);
  }
  return counts;
}

// ✗ CLAUDE.md hard rule: API routes must `export const prerender = false` (it is missing).
// ✗ api-server.md: delegate to `runApiRoute`; never build a Response by hand or use try/catch.
export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const parsed = statsQuerySchema.safeParse({ range: url.searchParams.get("range") });
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "bad range" }), { status: 400 });
    }
    const days = rangeToDays(parsed.data.range);
    const counts = await loadCounts(days);
    const total = counts.reduce((a, b) => a + b, 0);
    return new Response(JSON.stringify({ range: parsed.data.range, days, total }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "internal error" }), { status: 500 });
  }
};
