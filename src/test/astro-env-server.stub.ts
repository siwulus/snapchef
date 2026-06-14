// Test stub for the `astro:env/server` virtual module. Vitest aliases `astro:env/server`
// to this file (see vitest.config.ts) so server modules resolve their env imports under test.
// Values mirror the schema defaults declared in astro.config.mjs.
export const SUPABASE_URL: string | undefined = undefined;
export const SUPABASE_KEY: string | undefined = undefined;
export const OPENROUTER_API_KEY: string | undefined = undefined;
export const OPENROUTER_RECOGNITION_MODEL = "google/gemini-2.5-flash-lite";
export const OPENROUTER_RECOGNITION_FALLBACK_MODEL = "openai/gpt-4o-mini";
export const LOG_LEVEL = "Info";
export const LOG_HTTP_BODIES = false;
