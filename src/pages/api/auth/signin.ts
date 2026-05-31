import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { signInSchema } from "@/lib/validation/auth";
import type { ApiResult } from "@/types";

export const prerender = false;

function jsonResponse(data: ApiResult, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fieldErrorsFromIssues(issues: { path: (string | number)[]; message: string }[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in result)) {
      result[key] = issue.message;
    }
  }
  return result;
}

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ ok: false, message: "Invalid request body" }, 400);
  }

  const parsed = signInSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ ok: false, fieldErrors: fieldErrorsFromIssues(parsed.error.issues) }, 400);
  }

  const { email, password } = parsed.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ ok: false, message: "Supabase is not configured" }, 400);
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return jsonResponse({ ok: false, message: error.message }, 400);
  }

  return jsonResponse({ ok: true, redirect: "/recipes" }, 200);
};
