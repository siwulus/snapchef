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

// Success payload echoed by POST /api/auth/forgot-password so the client can render a neutral,
// anti-enumeration message naming the address the link was (or would be) sent to.
export const PasswordResetRequested = z.object({
  email: z.email(),
});

export type PasswordResetRequested = z.infer<typeof PasswordResetRequested>;
