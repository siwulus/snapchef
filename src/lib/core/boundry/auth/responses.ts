import { z } from "zod";

export const RedirectTarget = z.object({
  redirect: z.string(),
});

export type RedirectTarget = z.infer<typeof RedirectTarget>;

// Success payload echoed by POST /api/auth/resend so the client can confirm which address was used.
export const ConfirmationResent = z.object({
  email: z.email(),
});

export type ConfirmationResent = z.infer<typeof ConfirmationResent>;
