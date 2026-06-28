import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { runReview } from "./engine.js";
import { CliOptions } from "./options.js";
import { renderReview } from "./render.js";

export interface CliInput {
  /** Arguments after the node executable + script (i.e. `process.argv.slice(2)`). */
  argv: string[];
  /** The full diff read from stdin. */
  stdin: string;
  /** A present Anthropic credential (see {@link CREDENTIAL_ENV_VARS}), or undefined if none is set. */
  credential: string | undefined;
}

export interface CliResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

/**
 * Auth env vars the Claude Agent SDK honors, in our order of preference.
 * `CLAUDE_CODE_OAUTH_TOKEN` bills against a Claude Pro/Max subscription
 * (generate it once with `claude setup-token`); `ANTHROPIC_API_KEY` is the
 * standalone pay-as-you-go API key. The SDK subprocess reads whichever is set
 * from the inherited environment.
 */
export const CREDENTIAL_ENV_VARS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

const MISSING_CREDENTIAL_MESSAGE =
  "No Anthropic credential found. Set CLAUDE_CODE_OAUTH_TOKEN to use your Claude Pro/Max subscription " +
  "(generate it once with `claude setup-token`), or ANTHROPIC_API_KEY for pay-as-you-go API billing.";

/** First present credential from {@link CREDENTIAL_ENV_VARS}, or undefined when none is set. */
export const resolveCredential = (env: NodeJS.ProcessEnv): string | undefined =>
  CREDENTIAL_ENV_VARS.map((name) => env[name]).find((value) => value !== undefined && value.trim().length > 0);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Pure CLI flow: parse flags → validate → guard stdin/credentials → run the
 * review → render. Returns an exit code plus the text to print; the caller owns
 * all process I/O. Kept side-effect-free so it is unit-testable without spawning.
 */
export const runCli = async ({ argv, stdin, credential }: CliInput): Promise<CliResult> => {
  let values: { json: boolean; model?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        json: { type: "boolean", default: false },
        model: { type: "string" },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    return { code: 2, stderr: `Invalid arguments: ${errorMessage(error)}` };
  }

  const parsedOptions = CliOptions.safeParse({ json: values.json, model: values.model });
  if (!parsedOptions.success) {
    return { code: 2, stderr: `Invalid options: ${parsedOptions.error.message}` };
  }
  const options = parsedOptions.data;

  if (stdin.trim().length === 0) {
    return {
      code: 1,
      stderr: "No diff provided on stdin. Pipe a git diff, e.g. `git diff | pnpm --filter code-review review`.",
    };
  }

  if (credential === undefined || credential.trim().length === 0) {
    return { code: 1, stderr: MISSING_CREDENTIAL_MESSAGE };
  }

  try {
    const review = await runReview(stdin, { model: options.model });
    return { code: 0, stdout: renderReview(review, { json: options.json }) };
  } catch (error) {
    return { code: 1, stderr: `Code review failed: ${errorMessage(error)}` };
  }
};

const readStdin = async (): Promise<string> => {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const main = async (): Promise<void> => {
  const stdin = await readStdin();
  const result = await runCli({
    argv: process.argv.slice(2),
    stdin,
    credential: resolveCredential(process.env),
  });
  if (result.stdout !== undefined) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr !== undefined) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.code;
};

// Run only when executed directly (`tsx src/cli.ts`), not when imported by tests.
const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  void main();
}
