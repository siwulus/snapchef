// @vitest-environment jsdom
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import type { RedirectTarget } from "@/lib/core/boundry/auth";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted holder the mocked transport reads — set per test to the envelope the server would return,
// plus a call counter so a test can assert that client-side validation blocks the POST entirely.
const mocks = vi.hoisted(() => ({ response: null as ApiResponsePayload<RedirectTarget> | null, postCalls: 0 }));

vi.mock("@/components/hooks/useApiClient", async () => {
  const { Effect } = await import("effect");
  // An ok:false server response is still a *successful* transport result, so it rides the success channel.
  const post = () => {
    mocks.postCalls += 1;
    return Effect.succeed(mocks.response);
  };
  return { useApiClient: () => ({ post, postFormData: post }) };
});

beforeEach(() => {
  mocks.response = null;
  mocks.postCalls = 0;
  // jsdom doesn't implement navigation; stub location so `window.location.href = …` is observable.
  vi.stubGlobal("location", { href: "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderForm = () => {
  const user = userEvent.setup();
  render(<ResetPasswordForm tokenHash="tok-123" />);
  return user;
};

const submitWith = async (response: ApiResponsePayload<RedirectTarget>) => {
  mocks.response = response;
  const user = renderForm();
  await user.type(screen.getByLabelText("New password"), "newpassword123");
  await user.type(screen.getByLabelText("Confirm new password"), "newpassword123");
  await user.click(screen.getByRole("button", { name: "Set new password" }));
};

describe("ResetPasswordForm", () => {
  it("navigates to the redirect target on a successful reset", async () => {
    await submitWith({ ok: true, data: { redirect: "/recipes" } });

    await waitFor(() => {
      expect(window.location.href).toBe("/recipes");
    });
  });

  it("shows the invalid-link message and a 'request a new one' link on a 401", async () => {
    await submitWith({
      ok: false,
      error: { name: "SnapchefAuthenticationError", code: 401, message: "This password reset link is invalid" },
    });

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new reset link/i })).toBeInTheDocument();
  });

  it("shows the password-rejection message (not the link-expired copy) on a 422 weak password", async () => {
    await submitWith({
      ok: false,
      error: { name: "SnapchefBusinessRuleViolationError", code: 422, message: "Failed to update password" },
    });

    expect(await screen.findByText("Failed to update password")).toBeInTheDocument();
    expect(screen.queryByText(/invalid or has expired/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /request a new reset link/i })).toBeNull();
  });

  it("blocks submission client-side when the passwords don't match (no POST)", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText("New password"), "newpassword123");
    await user.type(screen.getByLabelText("Confirm new password"), "different456");
    await user.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(mocks.postCalls).toBe(0);
  });
});
