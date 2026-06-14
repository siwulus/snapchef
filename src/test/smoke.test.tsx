// @vitest-environment jsdom
// Temporary smoke test proving the jsdom + RTL + jest-dom pipeline works end-to-end.
// Removed in Phase 3 once real component tests cover the environment.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("jsdom + RTL smoke", () => {
  it("renders an element and finds it with a jest-dom matcher", () => {
    render(<p>snapchef</p>);
    expect(screen.getByText("snapchef")).toBeInTheDocument();
  });
});
