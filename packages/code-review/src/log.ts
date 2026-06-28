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

/**
 * Format one streamed SDK message into a concise, human-readable progress line —
 * or `undefined` for message types we don't surface. Pure and defensive: it never
 * throws on missing optional fields, so it is safe to call on every loop iteration.
 */
export const formatEvent = (message: SDKMessage): string | undefined => {
  switch (message.type) {
    case "assistant":
      return `· assistant turn — ${assistantPreview(message)}`;
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
