import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { formatEvent, reviewStartLine } from "./log.js";

// Test fixtures are partial; cast through unknown since the real SDKMessage union
// carries many fields (uuid, session_id, …) the formatter doesn't read.
const ev = (message: Record<string, unknown>): string | undefined => formatEvent(message as unknown as SDKMessage);

describe("reviewStartLine", () => {
  it("includes the model and a human-readable diff size", () => {
    expect(reviewStartLine("claude-sonnet-4-6", 120)).toContain("model=claude-sonnet-4-6");
    expect(reviewStartLine("claude-sonnet-4-6", 120)).toContain("120 B");
    expect(reviewStartLine("claude-opus-4-8", 2048)).toContain("2.0 KB");
  });
});

describe("formatEvent", () => {
  it("formats the system init message with model, tool count, and permission mode", () => {
    const line = ev({
      type: "system",
      subtype: "init",
      model: "claude-sonnet-4-6",
      tools: [],
      permissionMode: "bypassPermissions",
      mcp_servers: [],
    });
    expect(line).toContain("model=claude-sonnet-4-6");
    expect(line).toContain("tools=0");
    expect(line).toContain("permission=bypassPermissions");
  });

  it("previews an assistant message's text content", () => {
    const line = ev({
      type: "assistant",
      message: { content: [{ type: "text", text: "The change looks correct overall." }] },
    });
    expect(line).toContain("assistant turn");
    expect(line).toContain("The change looks correct overall.");
  });

  it("hints at non-text assistant blocks when there is no text", () => {
    const line = ev({ type: "assistant", message: { content: [{ type: "thinking", thinking: "…" }] } });
    expect(line).toContain("assistant turn");
    expect(line).toContain("thinking");
  });

  it("renders the tool calls in an assistant turn (the exploration loop)", () => {
    const line = ev({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "src/foo.ts" } },
          { type: "tool_use", name: "Grep", input: { pattern: "createClient" } },
        ],
      },
    });
    expect(line).toContain("→");
    expect(line).toContain("Read(src/foo.ts)");
    expect(line).toContain("Grep(createClient)");
  });

  it("summarizes a tool result from a user message as ok or error", () => {
    expect(ev({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } })).toBe("← ok");
    expect(ev({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "boom" }] } })).toBe(
      "← error",
    );
  });

  it("returns undefined for a user message that carries no tool result", () => {
    expect(ev({ type: "user", message: { content: [{ type: "text", text: "hi" }] } })).toBeUndefined();
  });

  it("formats an API retry with attempt counts, delay, and reason", () => {
    const line = ev({
      type: "system",
      subtype: "api_retry",
      attempt: 1,
      max_retries: 3,
      retry_delay_ms: 500,
      error: "overloaded",
    });
    expect(line).toContain("API retry 1/3");
    expect(line).toContain("500ms");
    expect(line).toContain("overloaded");
  });

  it("summarizes a successful result with turns, duration, cost, and tokens", () => {
    const line = ev({
      type: "result",
      subtype: "success",
      num_turns: 2,
      duration_ms: 1234,
      total_cost_usd: 0.0041,
      usage: { input_tokens: 1000, output_tokens: 200 },
    });
    expect(line).toContain("review complete");
    expect(line).toContain("2 turn(s)");
    expect(line).toContain("1234ms");
    expect(line).toContain("$0.0041");
    expect(line).toContain("1000/200 tok");
  });

  it("summarizes a failed result with the error subtype and messages", () => {
    const line = ev({
      type: "result",
      subtype: "error_during_execution",
      num_turns: 1,
      duration_ms: 50,
      errors: ["boom", "kaboom"],
    });
    expect(line).toContain("run failed (error_during_execution)");
    expect(line).toContain("boom; kaboom");
  });

  it("returns undefined for message types it does not surface", () => {
    expect(ev({ type: "stream_event", event: {} })).toBeUndefined();
    expect(ev({ type: "system", subtype: "thinking_tokens", estimated_tokens: 10 })).toBeUndefined();
  });
});
