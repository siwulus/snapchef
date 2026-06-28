import { defineConfig } from "vitest/config";

// Local config so the package's tests do not inherit the root Astro app's
// vitest config (its jsdom setup file and `@`/`astro:env` aliases are irrelevant here).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
