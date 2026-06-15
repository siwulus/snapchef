import { z } from "zod";

export const UserCredentials = z.object({
  email: z.email(),
  password: z.string().min(6),
});

export type UserCredentials = z.infer<typeof UserCredentials>;

// Input for the /auth/confirm callback. `type` is narrowed to the single value the confirmation
// template emits (`&type=email`), enforcing the template↔verifyOtp contract at the boundary and
// rejecting a crafted `?type=recovery`. Widen to z.enum([...]) only if recovery / email-change reuse
// this route (out of scope here).
export const EmailConfirmation = z.object({
  tokenHash: z.string().min(1),
  type: z.literal("email"),
});

export type EmailConfirmation = z.infer<typeof EmailConfirmation>;

// Input for re-sending the signup confirmation email — just the address.
export const ResendConfirmation = UserCredentials.pick({ email: true });

export type ResendConfirmation = z.infer<typeof ResendConfirmation>;

// Input for requesting a password reset — just the address (mirrors ResendConfirmation).
// resetPasswordForEmail succeeds whether or not an account exists (anti-enumeration).
export const RequestPasswordReset = UserCredentials.pick({ email: true });

export type RequestPasswordReset = z.infer<typeof RequestPasswordReset>;

// Input for redeeming a recovery link and setting the new password. `newPassword.min(6)` mirrors
// UserCredentials.password so a too-short password fails at the boundary (SnapchefValidationError,
// 400) before reaching the adapter. `type` is not part of this command: the adapter hardcodes
// "recovery" for verifyOtp; the URL `type` param is read only on the callback page.
export const ResetPassword = z.object({
  tokenHash: z.string().min(1),
  newPassword: z.string().min(6),
});

export type ResetPassword = z.infer<typeof ResetPassword>;
