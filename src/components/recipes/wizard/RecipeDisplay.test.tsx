// @vitest-environment jsdom
import { RecipeDisplay } from "@/components/recipes/wizard/RecipeDisplay";
import type { Recipe } from "@/lib/core/model/recipe";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted holder the mocked transport reads/records. `pending: true` keeps a request in flight so
// the busy-state can be asserted; otherwise the chosen envelope is returned.
const mocks = vi.hoisted(() => ({
  response: { ok: true, data: { redirect: "/recipes" } },
  pending: false,
  postCalls: [] as string[],
  delCalls: [] as string[],
}));

// Mock the whole client hook so no real fetch / sonner toast runs; record the URLs called and
// branch on the per-test envelope. `Effect.never` models an in-flight request for busy-state checks.
vi.mock("@/components/hooks/useApiClient", async () => {
  const { Effect } = await import("effect");
  return {
    useApiClient: () => ({
      post: (url: string) => {
        mocks.postCalls.push(url);
        return mocks.pending ? Effect.never : Effect.succeed(mocks.response);
      },
      del: (url: string) => {
        mocks.delCalls.push(url);
        return mocks.pending ? Effect.never : Effect.succeed(mocks.response);
      },
      postFormData: () => Effect.succeed(mocks.response),
    }),
  };
});

const recipe: Recipe = {
  id: "99999999-8888-7777-6666-555555555555",
  userId: "11111111-2222-3333-4444-555555555555",
  sessionId: "11111111-2222-3333-4444-555555555555",
  name: "Jajecznica ze szczypiorkiem",
  contentMd:
    "## Składniki\n\n- 4 jajka\n- masło\n- szczypiorek\n\n## Przygotowanie\n\n1. Rozgrzej patelnię.\n2. Wbij jajka i mieszaj.",
  createdAt: "2026-06-16T00:00:00.000Z",
};

const SAVE_URL = "/api/recipe-sessions/11111111-2222-3333-4444-555555555555/save";
const DELETE_URL = "/api/recipe-sessions/11111111-2222-3333-4444-555555555555";

const renderDisplay = () => {
  const onBeforeNavigate = vi.fn();
  render(<RecipeDisplay recipe={recipe} onBeforeNavigate={onBeforeNavigate} />);
  return { onBeforeNavigate };
};

beforeEach(() => {
  mocks.response = { ok: true, data: { redirect: "/recipes" } };
  mocks.pending = false;
  mocks.postCalls = [];
  mocks.delCalls = [];
  // jsdom does not implement navigation — stub assign so the success path does not throw.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: vi.fn() },
  });
});

describe("RecipeDisplay", () => {
  it("renders the AI name as the recipe title", () => {
    renderDisplay();
    expect(screen.getByText("Jajecznica ze szczypiorkiem")).toBeInTheDocument();
  });

  it("renders markdown section headings (not literal '##')", () => {
    renderDisplay();
    expect(screen.getByRole("heading", { name: "Składniki", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Przygotowanie", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText(/##/)).toBeNull();
  });

  it("renders the ingredient list items and preparation steps", () => {
    renderDisplay();
    expect(screen.getByText("4 jajka")).toBeInTheDocument();
    expect(screen.getByText("szczypiorek")).toBeInTheDocument();
    expect(screen.getByText("Rozgrzej patelnię.")).toBeInTheDocument();
  });

  it("save triggers a POST to the save URL", async () => {
    const user = userEvent.setup();
    renderDisplay();

    await user.click(screen.getByRole("button", { name: "Zapisz przepis" }));

    await waitFor(() => {
      expect(mocks.postCalls).toEqual([SAVE_URL]);
    });
    expect(mocks.delCalls).toHaveLength(0);
  });

  it("delete is gated behind the confirmation dialog — only confirm fires the DELETE", async () => {
    const user = userEvent.setup();
    renderDisplay();

    // Opening the dialog must not fire the request yet.
    await user.click(screen.getByRole("button", { name: "Usuń" }));
    expect(await screen.findByText("Usunąć przepis?")).toBeInTheDocument();
    expect(mocks.delCalls).toHaveLength(0);

    // Confirm (the dialog's destructive action) fires the DELETE.
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Usuń" }));

    await waitFor(() => {
      expect(mocks.delCalls).toEqual([DELETE_URL]);
    });
  });

  it("disables both actions while a request is in flight", async () => {
    mocks.pending = true;
    const user = userEvent.setup();
    renderDisplay();

    await user.click(screen.getByRole("button", { name: "Zapisz przepis" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Zapisz przepis" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Usuń" })).toBeDisabled();
  });
});
