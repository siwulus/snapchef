import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { formatEvent, reviewStartLine } from "./log.js";
import { buildUserPrompt, REVIEWER_PROMPT } from "./prompt.js";
import { deriveVerdict, Review, ReviewDraft } from "./review.js";

/**
 * Read-only tools the reviewer is given. Listing them in BOTH `tools` (the base set of
 * built-in tools the model can see) and `allowedTools` (auto-approved under `dontAsk`) means
 * the agent can explore the whole project — read files, glob, grep — but Write/Edit/Bash are
 * not even present in its tool surface. This is what lets it judge the diff against the full
 * codebase + the project's binding conventions, the way a local Claude Code session would.
 */
export const REVIEW_TOOLS = ["Read", "Glob", "Grep"] as const;

/**
 * Turn cap for the agentic loop. The reviewer needs turns to explore (Read/Glob/Grep across
 * the repo) AND to emit the final structured output. Set generously: if the cap is hit before
 * the structured review is produced, the run yields no `structured_output`, `runReview` throws,
 * and the CI gate fails closed. Watch the turn count in `--verbose` output when tuning.
 */
export const MAX_TURNS = 30;

export interface RunReviewOptions {
  /** Model id, e.g. "claude-sonnet-4-6" or "claude-opus-4-8". */
  model: string;
  /**
   * Absolute path to the project root, used as the agent's `cwd`. The reviewer reads files
   * and loads `CLAUDE.md` + the project conventions relative to this directory, so it MUST be
   * the repository root — not the package dir. In CI `pnpm --filter … exec` runs from
   * `packages/code-review`, so the caller passes the checkout root explicitly (see cli.ts).
   */
  projectRoot: string;
  /**
   * Optional sink for progress lines streamed during the agentic loop. When set,
   * each loggable SDK message is formatted (see {@link formatEvent}) and the
   * subprocess's own stderr is forwarded. When undefined, the run is silent.
   */
  log?: (line: string) => void;
}

/**
 * The JSON Schema the SDK validates the model's structured output against, derived from
 * {@link ReviewDraft} (the model emits the draft; the engine derives the verdict). Because
 * `areas` is an object with one required key per concern, this schema forces the model to
 * report every concern — coverage cannot be silently skipped during constrained generation.
 *
 * zod v4's `z.toJSONSchema` emits a top-level `$schema` (draft 2020-12) key. The Agent SDK's
 * structured-output preflight rejects a schema carrying it and silently drops the injected
 * `StructuredOutput` tool — the model then answers in plain text and `structured_output` is never
 * populated (no error is raised). Targeting draft-07 is what makes the tool inject and the
 * structured output actually fire.
 */
export const REVIEW_SCHEMA = z.toJSONSchema(ReviewDraft, { target: "draft-07" });

/**
 * Turn a git diff into a validated {@link Review} using the Agent SDK's native
 * structured output: `query()` is given an `outputFormat` JSON Schema, the SDK
 * validates the model's response against it (re-prompting on mismatch), and the
 * validated value arrives on the result message's `structured_output` field.
 *
 * The reviewer runs with the full project as context: `cwd` is the project root, read-only
 * tools ({@link REVIEW_TOOLS}) let it explore the codebase, and `settingSources: ["project"]`
 * with the `claude_code` system-prompt preset loads `CLAUDE.md` + the binding conventions. So
 * the diff is the change under review, but the model judges it against the whole repository —
 * callers, types, tests, conventions — like a local Claude Code session. It explores across
 * turns and emits the structured review as the final result; we parse that as a `ReviewDraft`,
 * derive the verdict from its per-area statuses, and assemble the canonical `Review`.
 *
 * Requires an Anthropic credential in the environment — `CLAUDE_CODE_OAUTH_TOKEN`
 * (Claude Pro/Max subscription) or `ANTHROPIC_API_KEY` — which the SDK subprocess inherits.
 */
export const runReview = async (diff: string, opts: RunReviewOptions): Promise<Review> => {
  const { log } = opts;
  log?.(reviewStartLine(opts.model, Buffer.byteLength(diff)));

  for await (const message of query({
    prompt: buildUserPrompt(diff),
    options: {
      model: opts.model,
      // The project root is the agent's working directory: file reads, glob, grep, and the
      // `settingSources` lookup of CLAUDE.md all resolve relative to it.
      cwd: opts.projectRoot,
      // Claude Code preset + project settings is the documented combination that loads
      // CLAUDE.md + the binding conventions; our reviewer mandate rides in `append`.
      systemPrompt: { type: "preset", preset: "claude_code", append: REVIEWER_PROMPT },
      settingSources: ["project"],
      maxTurns: MAX_TURNS,
      // Read-only context gathering: list the tools in BOTH `tools` (the model's base tool
      // surface) and `allowedTools` (auto-approved). Write/Edit/Bash are absent entirely.
      tools: [...REVIEW_TOOLS],
      allowedTools: [...REVIEW_TOOLS],
      // Never prompt in headless/CI; deny anything not pre-approved above (so even if the
      // model emitted a non-read-only tool, it could not run).
      permissionMode: "dontAsk",
      // Native structured output: the SDK constrains and validates the final result.
      outputFormat: { type: "json_schema", schema: REVIEW_SCHEMA },
      // Surface the SDK subprocess's own stderr only when the caller is logging.
      ...(log ? { stderr: (data: string) => log(`[claude] ${data.trimEnd()}`) } : {}),
    },
  })) {
    if (log) {
      const line = formatEvent(message);
      if (line !== undefined) log(line);
    }
    if (message.type === "result") {
      if (message.subtype === "success") {
        if (message.structured_output !== undefined) {
          const draft = ReviewDraft.parse(message.structured_output);
          return Review.parse({ ...draft, verdict: deriveVerdict(draft.areas) });
        }
        throw new Error("Code review failed: model did not produce a structured review");
      }
      const detail = message.errors.length > 0 ? message.errors.join("; ") : message.subtype;
      throw new Error(`Code review failed: ${detail}`);
    }
  }

  throw new Error("Code review failed: no result message");
};
