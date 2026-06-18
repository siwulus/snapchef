// @vitest-environment jsdom
import { WizardActions } from "@/components/recipes/wizard/WizardActions";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Hoisted holder the mocked transport reads/records. `pending: true` keeps a request in flight so
// the busy-state can be asserted; otherwise the chosen envelope is returned. `assign` is a local
// spy so we never reference the unbound DOM Location.assign method. The holder is typed (not cast)
// so `response` can hold either envelope branch across tests.
const mocks = vi.hoisted(() => {
  const holder: {
    response: { ok: true; data: { redirect: string } } | { ok: false; error: { message: string } };
    pending: boolean;
    postCalls: string[];
    delCalls: string[];
    assign: Mock<(url: string) => void>;
  } = {
    response: { ok: true, data: { redirect: "/recipes" } },
    pending: false,
    postCalls: [],
    delCalls: [],
    assign: vi.fn<(url: string) => void>(),
  };
  return holder;
});

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

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const SAVE_URL = `/api/recipe-sessions/${SESSION_ID}/save`;
const DELETE_URL = `/api/recipe-sessions/${SESSION_ID}`;

const renderActions = (showSave = true) => {
  const onBeforeNavigate = vi.fn();
  render(<WizardActions sessionId={SESSION_ID} onBeforeNavigate={onBeforeNavigate} showSave={showSave} />);
  return { onBeforeNavigate };
};

beforeEach(() => {
  mocks.response = { ok: true, data: { redirect: "/recipes" } };
  mocks.pending = false;
  mocks.postCalls = [];
  mocks.delCalls = [];
  mocks.assign = vi.fn<(url: string) => void>();
  // jsdom does not implement navigation — stub assign so the success path does not throw.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: mocks.assign },
  });
});

describe("WizardActions", () => {
  it("cancel is gated behind the confirm dialog — only confirm fires the DELETE and redirects", async () => {
    const user = userEvent.setup();
    const { onBeforeNavigate } = renderActions();

    // Opening the dialog must not fire the request yet.
    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(await screen.findByText("Anulować tworzenie przepisu?")).toBeInTheDocument();
    expect(mocks.delCalls).toHaveLength(0);

    // Confirm (the dialog's destructive action) fires the DELETE and redirects.
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Usuń" }));

    await waitFor(() => {
      expect(mocks.delCalls).toEqual([DELETE_URL]);
    });
    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(mocks.assign).toHaveBeenCalledWith("/recipes");
  });

  it("save posts to the save URL and redirects", async () => {
    const user = userEvent.setup();
    renderActions(true);

    await user.click(screen.getByRole("button", { name: "Zapisz przepis" }));

    await waitFor(() => {
      expect(mocks.postCalls).toEqual([SAVE_URL]);
    });
    expect(mocks.delCalls).toHaveLength(0);
    expect(mocks.assign).toHaveBeenCalledWith("/recipes");
  });

  it("omits Save on the review step (showSave=false) but keeps Cancel", () => {
    renderActions(false);
    expect(screen.queryByRole("button", { name: "Zapisz przepis" })).toBeNull();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeInTheDocument();
  });

  it("keeps the user on the page with a Polish error when the delete envelope fails", async () => {
    mocks.response = { ok: false, error: { message: "Nie udało się usunąć sesji." } };
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Usuń" }));

    expect(await screen.findByText("Nie udało się usunąć sesji.")).toBeInTheDocument();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("disables both actions while a request is in flight", async () => {
    mocks.pending = true;
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: "Zapisz przepis" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Zapisz przepis" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeDisabled();
  });
});
