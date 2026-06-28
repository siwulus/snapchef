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
  /** `process.env.ANTHROPIC_API_KEY`. */
  apiKey: string | undefined;
}

export interface CliResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Pure CLI flow: parse flags → validate → guard stdin/credentials → run the
 * review → render. Returns an exit code plus the text to print; the caller owns
 * all process I/O. Kept side-effect-free so it is unit-testable without spawning.
 */
export const runCli = async ({ argv, stdin, apiKey }: CliInput): Promise<CliResult> => {
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

  if (apiKey === undefined || apiKey.trim().length === 0) {
    return { code: 1, stderr: "ANTHROPIC_API_KEY is not set. Export it before running the reviewer." };
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
    apiKey: process.env.ANTHROPIC_API_KEY,
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
