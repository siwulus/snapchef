// @vitest-environment jsdom
import { WizardStepper } from "@/components/recipes/wizard/WizardStepper";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

type Step = "upload" | "review" | "recipe";

const reachable =
  (steps: Step[]) =>
  (step: Step): boolean =>
    steps.includes(step);

describe("WizardStepper", () => {
  it("renders the three labels and marks the current step", () => {
    render(
      <WizardStepper current="review" canNavigate={reachable(["upload", "review"])} onNavigate={() => undefined} />,
    );

    expect(screen.getByRole("button", { name: "Zdjęcia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Przepis" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Produkty" })).toHaveAttribute("aria-current", "step");
  });

  it("lets the user click a reachable step and reports it through onNavigate", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn<(step: Step) => void>();
    render(
      <WizardStepper
        current="recipe"
        canNavigate={reachable(["upload", "review", "recipe"])}
        onNavigate={onNavigate}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Zdjęcia" }));
    expect(onNavigate).toHaveBeenCalledWith("upload");
  });

  it("disables steps that are not yet reachable", () => {
    render(<WizardStepper current="upload" canNavigate={reachable(["upload"])} onNavigate={() => undefined} />);

    expect(screen.getByRole("button", { name: "Zdjęcia" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Produkty" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Przepis" })).toBeDisabled();
  });

  it("disables every step while an operation is in flight (disabled)", () => {
    render(<WizardStepper current="review" canNavigate={() => true} onNavigate={() => undefined} disabled />);

    expect(screen.getByRole("button", { name: "Zdjęcia" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Produkty" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Przepis" })).toBeDisabled();
  });
});
