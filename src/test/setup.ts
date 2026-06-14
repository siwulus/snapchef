// Global Vitest setup. Registers jest-dom matchers on Vitest's `expect` and runs React Testing
// Library cleanup after every test. Globals are intentionally off in this project (tests import
// from "vitest" explicitly), so we wire `afterEach(cleanup)` by hand rather than relying on RTL's
// auto-cleanup, which depends on the global `afterEach`.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
