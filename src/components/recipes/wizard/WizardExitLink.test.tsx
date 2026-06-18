// @vitest-environment jsdom
import { WizardExitLink } from "@/components/recipes/wizard/WizardExitLink";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const BACK_LABEL = "← Wróć do przepisów";

// Local mock for window.location.assign — referencing the DOM method directly trips the
// unbound-method lint rule, so we capture our own spy and assert against it.
const mocks = vi.hoisted(() => ({ assign: vi.fn<(url: string) => void>() }));

beforeEach(() => {
  mocks.assign = vi.fn<(url: string) => void>();
  // jsdom does not implement navigation — stub assign so clicking the link does not throw.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: mocks.assign },
  });
});

describe("WizardExitLink", () => {
  it("navigates straight to /recipes when there is no unsaved work", async () => {
    const user = userEvent.setup();
    render(<WizardExitLink dirty={false} onBeforeNavigate={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: BACK_LABEL }));

    expect(mocks.assign).toHaveBeenCalledWith("/recipes");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("opens a confirm dialog instead of navigating when there is unsaved work", async () => {
    const user = userEvent.setup();
    render(<WizardExitLink dirty onBeforeNavigate={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: BACK_LABEL }));

    expect(await screen.findByText("Opuścić bez zapisywania?")).toBeInTheDocument();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("on confirm disarms the leave-guard before navigating to /recipes", async () => {
    const user = userEvent.setup();
    const onBeforeNavigate = vi.fn();
    render(<WizardExitLink dirty onBeforeNavigate={onBeforeNavigate} />);

    await user.click(screen.getByRole("button", { name: BACK_LABEL }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Opuść" }));

    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(mocks.assign).toHaveBeenCalledWith("/recipes");
  });
});
