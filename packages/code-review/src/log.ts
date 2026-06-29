import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** First numeric value among the given keys (tolerant of snake_case vs camelCase wire shapes). */
const numField = (obj: unknown, ...keys: string[]): number | undefined => {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number") return value;
  }
  return undefined;
};

const truncate = (text: string, max = 1000): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const formatBytes = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

/** The line emitted just before the query loop starts. */
export const reviewStartLine = (model: string, diffBytes: number): string =>
  `→ reviewing diff (model=${model}, ${formatBytes(diffBytes)})`;

/** Single-line preview of an assistant message's text blocks, with a hint for non-text blocks. */
const assistantPreview = (message: { message?: unknown }): string => {
  const content: unknown = isRecord(message.message) ? message.message.content : undefined;
  if (!Array.isArray(content)) return "(no content)";
  const text = content
    .filter(
      (block): block is { text: string } => isRecord(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 0) return truncate(text);
  const kinds = content.filter(isRecord).map((block) => String(block.type ?? "?"));
  return kinds.length > 0 ? `(${kinds.join(", ")})` : "(empty)";
};

/** The content blocks of a streamed assistant/user message (`message.message.content`), or `[]`. */
const contentBlocks = (message: { message?: unknown }): unknown[] => {
  const content: unknown = isRecord(message.message) ? message.message.content : undefined;
  return Array.isArray(content) ? content : [];
};

/** Salient argument of a tool call, for a compact `Read(src/foo.ts)`-style label. */
const briefToolInput = (input: unknown): string => {
  if (!isRecord(input)) return "";
  const salient = input.file_path ?? input.path ?? input.pattern ?? input.query;
  if (typeof salient === "string") return truncate(salient, 80);
  const firstString = Object.values(input).find((value): value is string => typeof value === "string");
  return firstString !== undefined ? truncate(firstString, 80) : "";
};

/**
 * The tool calls in an assistant message, e.g. `Read(src/foo.ts), Grep(port)` — or `undefined`
 * when the message makes none. This is how the agentic exploration loop becomes visible under
 * `--verbose`: each Read/Glob/Grep the reviewer issues against the project shows up.
 */
const toolUseSummary = (message: { message?: unknown }): string | undefined => {
  const calls = contentBlocks(message)
    .filter(
      (block): block is { name: string; input?: unknown } =>
        isRecord(block) && block.type === "tool_use" && typeof block.name === "string",
    )
    .map((block) => {
      const arg = briefToolInput(block.input);
      return arg.length > 0 ? `${block.name}(${arg})` : block.name;
    });
  return calls.length > 0 ? calls.join(", ") : undefined;
};

/** Brief `ok` / `error` summary of the tool_result blocks in a user message, or `undefined`. */
const toolResultSummary = (message: { message?: unknown }): string | undefined => {
  const results = contentBlocks(message).filter(
    (block): block is Record<string, unknown> => isRecord(block) && block.type === "tool_result",
  );
  if (results.length === 0) return undefined;
  return results.some((block) => block.is_error === true) ? "error" : "ok";
};

/**
 * Format one streamed SDK message into a concise, human-readable progress line —
 * or `undefined` for message types we don't surface. Pure and defensive: it never
 * throws on missing optional fields, so it is safe to call on every loop iteration.
 */
export const formatEvent = (message: SDKMessage): string | undefined => {
  switch (message.type) {
    case "assistant": {
      // A turn that calls tools is more informative shown as the calls themselves; a
      // text-only turn (reasoning) keeps the plain preview.
      const tools = toolUseSummary(message);
      return tools !== undefined ? `→ ${tools}` : `· assistant turn — ${assistantPreview(message)}`;
    }
    case "user": {
      const result = toolResultSummary(message);
      return result !== undefined ? `← ${result}` : undefined;
    }
    case "result": {
      const turns = numField(message, "num_turns") ?? "?";
      const duration = numField(message, "duration_ms") ?? "?";
      if (message.subtype === "success") {
        const cost = numField(message, "total_cost_usd");
        const input = numField(message.usage, "input_tokens", "inputTokens");
        const output = numField(message.usage, "output_tokens", "outputTokens");
        const tokens = input !== undefined || output !== undefined ? `, ${input ?? "?"}/${output ?? "?"} tok` : "";
        const dollars = cost !== undefined ? `, $${cost.toFixed(4)}` : "";
        return `✓ review complete — ${turns} turn(s), ${duration}ms${dollars}${tokens}`;
      }
      const errors = message.errors.length > 0 ? `; ${message.errors.join("; ")}` : "";
      return `✗ run failed (${message.subtype}) — ${turns} turn(s), ${duration}ms${errors}`;
    }
    case "system":
      switch (message.subtype) {
        case "init":
          return `· session ready — model=${message.model}, tools=${message.tools.length}, permission=${message.permissionMode}`;
        case "status":
          return message.status !== null ? `· status: ${message.status}` : undefined;
        case "api_retry":
          return `⟳ API retry ${message.attempt}/${message.max_retries} in ${message.retry_delay_ms}ms (${message.error})`;
        default:
          return undefined;
      }
    default:
      return undefined;
  }
};
