// @vitest-environment jsdom
import SignInForm from "@/components/auth/SignInForm";
import type { RedirectTarget } from "@/lib/core/boundry/auth";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// Hoisted holder the mocked transport reads — set per test to the envelope the server would return.
const mocks = vi.hoisted(() => ({ response: null as ApiResponsePayload<RedirectTarget> | null }));

// Mock the whole client hook so no real fetch / sonner toast runs; the success channel carries the
// chosen envelope (an ok:false server response is still a *successful* transport result).
vi.mock("@/components/hooks/useApiClient", async () => {
  const { Effect } = await import("effect");
  // Each test sets mocks.response before submitting; the runtime value is always a full envelope.
  const post = () => Effect.succeed(mocks.response);
  return { useApiClient: () => ({ post, postFormData: post }) };
});

const submitWith = async (response: ApiResponsePayload<RedirectTarget>) => {
  mocks.response = response;
  const user = userEvent.setup();
  render(<SignInForm />);
  await user.type(screen.getByLabelText("Email"), "user@example.com");
  await user.type(screen.getByLabelText("Password"), "password123");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
};

const resendButton = () => screen.queryByRole("button", { name: /resend confirmation email/i });

describe("SignInForm — email-not-confirmed branch", () => {
  it("shows the verify message and an inline resend control when error.name is SnapchefEmailNotConfirmedError", async () => {
    await submitWith({
      ok: false,
      error: { name: "SnapchefEmailNotConfirmedError", code: 403, message: "Email not confirmed" },
    });

    expect(await screen.findByText(/confirm your email address before signing in/i)).toBeInTheDocument();
    expect(resendButton()).toBeInTheDocument();
  });

  it("shows only the server message (no resend control) for a generic auth error", async () => {
    await submitWith({
      ok: false,
      error: { name: "SnapchefAuthenticationError", code: 401, message: "Invalid login credentials" },
    });

    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument();
    expect(resendButton()).toBeNull();
  });
});
