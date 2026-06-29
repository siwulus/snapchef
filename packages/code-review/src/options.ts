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
  verbose: z.boolean().default(false),
  /**
   * Project root the reviewer runs against (the agent's `cwd`; where `CLAUDE.md` and the repo
   * are read from). Optional here — when omitted the CLI falls back to the resolved repo root
   * (see {@link cli.runCli}). In CI it is passed explicitly as `GITHUB_WORKSPACE`.
   */
  projectRoot: z.string().min(1).optional(),
});

export type CliOptions = z.infer<typeof CliOptions>;
