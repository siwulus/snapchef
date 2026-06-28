import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";
import { Review, ReviewShape } from "./review.js";

export interface RunReviewOptions {
  /** Model id, e.g. "claude-sonnet-4-6" or "claude-opus-4-8". */
  model: string;
}

/** In-process MCP server name; the review tool is surfaced as `mcp__<server>__<tool>`. */
export const MCP_SERVER_NAME = "code-review";
export const REVIEW_TOOL_NAME = "review";
/** The fully-qualified tool id used in `allowedTools`. */
export const REVIEW_TOOL_ID = `mcp__${MCP_SERVER_NAME}__${REVIEW_TOOL_NAME}`;

/**
 * Turn a git diff into a validated {@link Review} by forcing Claude to call the
 * mandatory `review` tool exactly once, in a single-shot headless run with all
 * built-in tools disabled.
 *
 * The structured output is obtained natively: the SDK validates the model's tool
 * input against {@link ReviewShape} before invoking the handler, so the handler
 * receives already-validated args. We re-parse through the `Review` object schema
 * to normalize the captured value to the canonical domain type.
 *
 * Requires `ANTHROPIC_API_KEY` in the environment (the SDK subprocess inherits it).
 */
export const runReview = async (diff: string, opts: RunReviewOptions): Promise<Review> => {
  let captured: Review | undefined;

  const reviewTool = tool(REVIEW_TOOL_NAME, "Submit the completed code review.", ReviewShape, (args) => {
    captured = Review.parse(args);
    return Promise.resolve({ content: [{ type: "text" as const, text: "Review recorded." }] });
  });

  const server = createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: "0.0.1",
    tools: [reviewTool],
  });

  for await (const message of query({
    prompt: buildUserPrompt(diff),
    options: {
      model: opts.model,
      maxTurns: 1,
      // Disable every built-in tool; the review tool is the only thing the model can call.
      tools: [],
      allowedTools: [REVIEW_TOOL_ID],
      // Headless single-shot run: never prompt. `bypassPermissions` is gated behind
      // `allowDangerouslySkipPermissions` in this SDK version; safe here because the
      // only reachable tool is our side-effect-free in-process `review` tool.
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // A plain string is the SDK's "custom system prompt" form (it replaces the default).
      systemPrompt: SYSTEM_PROMPT,
      mcpServers: { [MCP_SERVER_NAME]: server },
    },
  })) {
    if (message.type === "result") {
      // If the model already submitted a review, succeed — even if the run then
      // hit `maxTurns` (a tool call with no follow-up turn surfaces as an error subtype).
      if (captured) break;
      // A clean run that captured nothing means the model answered without the tool.
      if (message.subtype === "success") {
        throw new Error("Model did not call the review tool");
      }
      const detail = message.errors.length > 0 ? message.errors.join("; ") : message.subtype;
      throw new Error(`Code review failed: ${detail}`);
    }
  }

  if (!captured) {
    throw new Error("Model did not call the review tool");
  }
  return captured;
};
