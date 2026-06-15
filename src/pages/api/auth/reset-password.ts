import { ResetPassword, type RedirectTarget } from "@/lib/core/boundry/auth";
import { parseRequestBody, runApiRoute } from "@/lib/infrastructure/api";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

// Redeems the recovery token and sets the new password. resetPassword runs verifyOtp(recovery) then
// updateUser on the request-scoped Supabase client, so a successful redeem writes the session cookie
// onto this response — the client follows the /recipes redirect already authenticated. Failures
// surface as the typed envelope: 401 (bad/expired token), 422 (weak password), 400 (validation).
export const POST: APIRoute = ({ request, locals: { authenticator } }) =>
  runApiRoute(
    parseRequestBody(request, ResetPassword).pipe(
      Effect.flatMap((body) => authenticator.resetPassword(body)),
      Effect.as<RedirectTarget>({ redirect: "/recipes" }),
    ),
  );
