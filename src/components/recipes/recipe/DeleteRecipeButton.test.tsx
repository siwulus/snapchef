// @vitest-environment jsdom
import DeleteRecipeButton from "@/components/recipes/recipe/DeleteRecipeButton";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted holder the mocked transport reads/records. `pending: true` keeps a request in flight so
// the busy-state can be asserted; otherwise the chosen envelope is returned.
const mocks = vi.hoisted(() => ({
  response: { ok: true, data: { redirect: "/recipes" } },
  pending: false,
  delCalls: [] as string[],
}));

// Mock the client hook so no real fetch / sonner toast runs; record DELETE URLs and branch on the
// per-test envelope. `Effect.never` models an in-flight request for busy-state checks.
vi.mock("@/components/hooks/useApiClient", async () => {
  const { Effect } = await import("effect");
  return {
    useApiClient: () => ({
      del: (url: string) => {
        mocks.delCalls.push(url);
        return mocks.pending ? Effect.never : Effect.succeed(mocks.response);
      },
      post: () => Effect.succeed(mocks.response),
      postFormData: () => Effect.succeed(mocks.response),
    }),
  };
});

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const DELETE_URL = `/api/recipe-sessions/${SESSION_ID}`;

beforeEach(() => {
  mocks.response = { ok: true, data: { redirect: "/recipes" } };
  mocks.pending = false;
  mocks.delCalls = [];
  // jsdom does not implement navigation — stub assign so the success path does not throw.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: vi.fn() },
  });
});

describe("DeleteRecipeButton", () => {
  it("opens the confirmation dialog without firing the DELETE", async () => {
    const user = userEvent.setup();
    render(<DeleteRecipeButton sessionId={SESSION_ID} />);

    await user.click(screen.getByRole("button", { name: "Usuń" }));

    expect(await screen.findByText("Usunąć przepis?")).toBeInTheDocument();
    expect(mocks.delCalls).toHaveLength(0);
  });

  it("fires the DELETE only when the dialog is confirmed", async () => {
    const user = userEvent.setup();
    render(<DeleteRecipeButton sessionId={SESSION_ID} />);

    await user.click(screen.getByRole("button", { name: "Usuń" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Usuń" }));

    await waitFor(() => {
      expect(mocks.delCalls).toEqual([DELETE_URL]);
    });
  });

  it("disables the trigger while a request is in flight", async () => {
    mocks.pending = true;
    const user = userEvent.setup();
    render(<DeleteRecipeButton sessionId={SESSION_ID} />);

    await user.click(screen.getByRole("button", { name: "Usuń" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Usuń" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Usuń" })).toBeDisabled();
    });
  });
});
