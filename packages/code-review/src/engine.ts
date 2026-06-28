import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { formatEvent, reviewStartLine } from "./log.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";
import { Review } from "./review.js";

export interface RunReviewOptions {
  /** Model id, e.g. "claude-sonnet-4-6" or "claude-opus-4-8". */
  model: string;
  /**
   * Optional sink for progress lines streamed during the agentic loop. When set,
   * each loggable SDK message is formatted (see {@link formatEvent}) and the
   * subprocess's own stderr is forwarded. When undefined, the run is silent.
   */
  log?: (line: string) => void;
}

/**
 * The JSON Schema the SDK validates the model's structured output against, derived from {@link Review}.
 *
 * zod v4's `z.toJSONSchema` emits a top-level `$schema` (draft 2020-12) key. The Agent SDK's
 * structured-output preflight rejects a schema carrying it and silently drops the injected
 * `StructuredOutput` tool — the model then answers in plain text and `structured_output` is never
 * populated (no error is raised). Stripping `$schema` is what makes the tool inject and the
 * structured output actually fire.
 */
const REVIEW_SCHEMA = z.toJSONSchema(Review, { target: "draft-07" });

/**
 * Turn a git diff into a validated {@link Review} using the Agent SDK's native
 * structured output: `query()` is given an `outputFormat` JSON Schema, the SDK
 * validates the model's response against it (re-prompting on mismatch), and the
 * validated value arrives on the result message's `structured_output` field.
 *
 * The reviewer reads only the diff, so every built-in tool is disabled. We re-parse
 * the captured value through the `Review` object schema to normalize it to the
 * canonical domain type and enforce client-side refinements.
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
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: 3,
      tools: [],
      allowedTools: [],
      //Headless single-shot run: never prompt. `bypassPermissions` is gated behind
      // `allowDangerouslySkipPermissions` in this SDK version; safe here because the
      // model has no tools to call.
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
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
          return Review.parse(message.structured_output);
        }
        throw new Error("Code review failed: model did not produce a structured review");
      }
      const detail = message.errors.length > 0 ? message.errors.join("; ") : message.subtype;
      throw new Error(`Code review failed: ${detail}`);
    }
  }

  throw new Error("Code review failed: no result message");
};
