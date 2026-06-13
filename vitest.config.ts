/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Astro's `getViteConfig` pulls in the Cloudflare Vite plugin, which is incompatible with
// Vitest's environment config. Instead, alias the `astro:env/server` virtual module to a
// test stub so server modules resolve their env imports without the full Astro pipeline.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "astro:env/server": fileURLToPath(new URL("./src/test/astro-env-server.stub.ts", import.meta.url)),
    },
  },
});
