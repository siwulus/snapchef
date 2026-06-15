import { createSupabaseAuthenticator } from "@/lib/infrastructure/auth/SupabaseAuthenticator";
import {
  SnapchefAuthenticationError,
  SnapchefBusinessRuleViolationError,
  SnapchefEmailNotConfirmedError,
  SnapchefExternalSystemError,
} from "@/lib/core/model/error";
import type { Database } from "@/lib/infrastructure/db/types";
import { AuthApiError, type SupabaseClient } from "@supabase/supabase-js";
import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";

// A real Supabase user id is a uuid — required by the SnapchefUser model the AuthUser decoder pipes into.
const USER_ID = "5838d7ca-5e55-4924-9f8e-e230946fe24a";

type AuthResult = Promise<{ data: unknown; error: unknown }>;

interface FakeAuth {
  signInWithPassword?: () => AuthResult;
  verifyOtp?: () => AuthResult;
  resend?: () => AuthResult;
  resetPasswordForEmail?: (email: string) => AuthResult;
  updateUser?: (attributes: { password: string }) => AuthResult;
}

// The adapter only ever touches `supabase.auth.*`; a partial fake cast to the client is enough.
const fakeAuthenticator = (auth: FakeAuth) =>
  createSupabaseAuthenticator({ auth } as unknown as SupabaseClient<Database>);

// Collapse the typed failure channel into an Either so a test can assert on the left without a Cause walk.
const runEither = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.either(effect));

describe("createSupabaseAuthenticator — error classification", () => {
  it("classifies an unconfirmed-email sign-in (email_not_confirmed) as SnapchefEmailNotConfirmedError (403)", async () => {
    const auth = fakeAuthenticator({
      signInWithPassword: () =>
        Promise.resolve({ data: null, error: new AuthApiError("Email not confirmed", 400, "email_not_confirmed") }),
    });

    const result = await runEither(auth.signIn({ email: "a@b.com", password: "password123" }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefEmailNotConfirmedError);
      expect(result.left.code).toBe(403);
    }
  });

  it("classifies a generic 4xx AuthApiError (bad credentials) as SnapchefAuthenticationError (401)", async () => {
    const auth = fakeAuthenticator({
      signInWithPassword: () =>
        Promise.resolve({
          data: null,
          error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
        }),
    });

    const result = await runEither(auth.signIn({ email: "a@b.com", password: "password123" }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefAuthenticationError);
      expect(result.left.code).toBe(401);
    }
  });

  it("classifies a 5xx AuthApiError as SnapchefExternalSystemError (500)", async () => {
    const auth = fakeAuthenticator({
      signInWithPassword: () =>
        Promise.resolve({ data: null, error: new AuthApiError("Internal error", 500, "unexpected_failure") }),
    });

    const result = await runEither(auth.signIn({ email: "a@b.com", password: "password123" }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefExternalSystemError);
      expect(result.left.code).toBe(500);
    }
  });
});

describe("createSupabaseAuthenticator — confirmEmail", () => {
  it("decodes the verifyOtp user into a SnapchefUser on success", async () => {
    const auth = fakeAuthenticator({
      verifyOtp: () => Promise.resolve({ data: { user: { id: USER_ID, email: "a@b.com" }, session: {} }, error: null }),
    });

    const result = await runEither(auth.confirmEmail({ tokenHash: "tok", type: "email" }));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.id).toBe(USER_ID);
      expect(result.right.email).toBe("a@b.com");
    }
  });

  it("fails SnapchefEmailNotConfirmedError when verifyOtp returns email_not_confirmed", async () => {
    const auth = fakeAuthenticator({
      verifyOtp: () =>
        Promise.resolve({ data: null, error: new AuthApiError("Email not confirmed", 400, "email_not_confirmed") }),
    });

    const result = await runEither(auth.confirmEmail({ tokenHash: "tok", type: "email" }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefEmailNotConfirmedError);
    }
  });
});

describe("createSupabaseAuthenticator — resendConfirmation", () => {
  it("succeeds with void when resend returns no error", async () => {
    const auth = fakeAuthenticator({
      resend: () => Promise.resolve({ data: { user: null, session: null }, error: null }),
    });

    const result = await runEither(auth.resendConfirmation({ email: "a@b.com" }));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toBeUndefined();
    }
  });

  it("fails SnapchefExternalSystemError when resend returns an error (e.g. throttled)", async () => {
    const auth = fakeAuthenticator({
      resend: () =>
        Promise.resolve({
          data: null,
          error: new AuthApiError("over_email_send_rate_limit", 429, "over_email_send_rate_limit"),
        }),
    });

    const result = await runEither(auth.resendConfirmation({ email: "a@b.com" }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefExternalSystemError);
      expect(result.left.code).toBe(500);
    }
  });
});

describe("createSupabaseAuthenticator — requestPasswordReset", () => {
  it("succeeds with void when resetPasswordForEmail returns no error", async () => {
    const auth = fakeAuthenticator({
      resetPasswordForEmail: () => Promise.resolve({ data: {}, error: null }),
    });

    const result = await runEither(auth.requestPasswordReset({ email: "a@b.com" }));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toBeUndefined();
    }
  });

  it("fails SnapchefExternalSystemError when resetPasswordForEmail returns an error (e.g. throttled)", async () => {
    const auth = fakeAuthenticator({
      resetPasswordForEmail: () =>
        Promise.resolve({
          data: null,
          error: new AuthApiError("over_email_send_rate_limit", 429, "over_email_send_rate_limit"),
        }),
    });

    const result = await runEither(auth.requestPasswordReset({ email: "a@b.com" }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefExternalSystemError);
      expect(result.left.code).toBe(500);
    }
  });
});

describe("createSupabaseAuthenticator — resetPassword", () => {
  it("redeems the token then updates the password, decoding the updated user", async () => {
    let updatePassword: string | undefined;
    const auth = fakeAuthenticator({
      verifyOtp: () => Promise.resolve({ data: { user: { id: USER_ID, email: "a@b.com" }, session: {} }, error: null }),
      updateUser: ({ password }) => {
        updatePassword = password;
        return Promise.resolve({ data: { user: { id: USER_ID, email: "a@b.com" } }, error: null });
      },
    });

    const result = await runEither(auth.resetPassword({ tokenHash: "tok", newPassword: "newpassword123" }));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.id).toBe(USER_ID);
      expect(result.right.email).toBe("a@b.com");
    }
    expect(updatePassword).toBe("newpassword123");
  });

  it("fails SnapchefAuthenticationError (401) and does NOT call updateUser when verifyOtp rejects the token", async () => {
    let updateUserCalled = false;
    const auth = fakeAuthenticator({
      verifyOtp: () =>
        Promise.resolve({ data: null, error: new AuthApiError("Token has expired or is invalid", 401, "otp_expired") }),
      updateUser: () => {
        updateUserCalled = true;
        return Promise.resolve({ data: { user: { id: USER_ID, email: "a@b.com" } }, error: null });
      },
    });

    const result = await runEither(auth.resetPassword({ tokenHash: "tok", newPassword: "newpassword123" }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefAuthenticationError);
      expect(result.left.code).toBe(401);
    }
    expect(updateUserCalled).toBe(false);
  });

  it("fails SnapchefExternalSystemError (500) on a 5xx from verifyOtp", async () => {
    const auth = fakeAuthenticator({
      verifyOtp: () =>
        Promise.resolve({ data: null, error: new AuthApiError("Internal error", 500, "unexpected_failure") }),
    });

    const result = await runEither(auth.resetPassword({ tokenHash: "tok", newPassword: "newpassword123" }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefExternalSystemError);
      expect(result.left.code).toBe(500);
    }
  });

  it("fails SnapchefBusinessRuleViolationError (422) when updateUser rejects a weak_password", async () => {
    const auth = fakeAuthenticator({
      verifyOtp: () => Promise.resolve({ data: { user: { id: USER_ID, email: "a@b.com" }, session: {} }, error: null }),
      updateUser: () =>
        Promise.resolve({ data: null, error: new AuthApiError("Password is too weak", 422, "weak_password") }),
    });

    const result = await runEither(auth.resetPassword({ tokenHash: "tok", newPassword: "short" }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefBusinessRuleViolationError);
      expect(result.left.code).toBe(422);
    }
  });
});
