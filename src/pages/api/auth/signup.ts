import type { APIRoute } from "astro";
import { createClient } from "@/lib/infrastructure/db/supabase";
import { UserCredentials } from "@/lib/core/model/auth";
import type { ApiResult } from "@/lib/infrastructure/api/types";

export const prerender = false;

const jsonResponse = (data: ApiResult, status: number): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fieldErrorsFromIssues = (issues: { path: PropertyKey[]; message: string }[]): Record<string, string> =>
  issues.reduce<Record<string, string>>((acc, issue) => {
    const key = issue.path[0];
    return typeof key === "string" && !(key in acc) ? { ...acc, [key]: issue.message } : acc;
  }, {});

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ ok: false, message: "Invalid request body" }, 400);
  }

  const parsed = UserCredentials.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ ok: false, fieldErrors: fieldErrorsFromIssues(parsed.error.issues) }, 400);
  }

  const { email, password } = parsed.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ ok: false, message: "Supabase is not configured" }, 400);
  }

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return jsonResponse({ ok: false, message: error.message }, 400);
  }

  return jsonResponse({ ok: true, redirect: "/auth/confirm-email" }, 200);
};
