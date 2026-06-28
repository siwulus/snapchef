import { z } from "zod";

/** Default model used when `--model` is not supplied. */
export const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * Validated CLI options. Parsed from `node:util` `parseArgs` output in `cli.ts`,
 * then run through `CliOptions.parse(...)` so defaults are applied and bad input
 * fails clearly.
 */
export const CliOptions = z.object({
  json: z.boolean().default(false),
  model: z.string().min(1).default(DEFAULT_MODEL),
});

export type CliOptions = z.infer<typeof CliOptions>;
