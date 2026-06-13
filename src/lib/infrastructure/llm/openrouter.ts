import type { ProductRecognizer } from "@/lib/core/boundry/recipe";
import { SnapchefExternalSystemError, type SnapchefServerError } from "@/lib/core/model/error";
import { RecognizedItem } from "@/lib/core/model/recipe";
import { decodeWith, fromNullable } from "@/lib/utils/effect";
import { OpenRouter } from "@openrouter/sdk";
import type { ChatMessages, ChatResult } from "@openrouter/sdk/models";
import {
  OPENROUTER_API_KEY,
  OPENROUTER_RECOGNITION_FALLBACK_MODEL,
  OPENROUTER_RECOGNITION_MODEL,
} from "astro:env/server";
import { Effect } from "effect";
import { z } from "zod";
import { buildMergeMessages, buildRecognitionMessages } from "./prompts";
import { P, match } from "ts-pattern";

// Both port methods target the same wire shape; RecognizedItem carries the FR-004/quantity rules.
const RecognizedItemsResult = z.object({ items: z.array(RecognizedItem) });
type RecognizedItemsResult = z.infer<typeof RecognizedItemsResult>;

const asExternal = (message: string) => (cause: unknown) => new SnapchefExternalSystemError({ message, cause });
// Retry + timeout are the UC's responsibility (Effect.retry/Effect.timeout); the SDK must not
// add a second, hidden retry loop on top of it.
const client = Effect.fromNullable(OPENROUTER_API_KEY).pipe(
  Effect.map((key) => new OpenRouter({ apiKey: key, appTitle: "Snapchef", retryConfig: { strategy: "none" } })),
  Effect.mapError(asExternal("OPENROUTER_API_KEY is not configured")),
);

// Drop the top-level $schema key — strict providers (OpenAI) reject unknown root members.
const toStrictJsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _schema, ...rest } = jsonSchema;
  return rest;
};

const sendChatRequest = (
  client: OpenRouter,
  params: { messages: ChatMessages[]; schema: z.ZodType; schemaName: string },
): Promise<ChatResult> =>
  client.chat.send({
    chatRequest: {
      models: [OPENROUTER_RECOGNITION_MODEL, OPENROUTER_RECOGNITION_FALLBACK_MODEL],
      messages: params.messages,
      responseFormat: {
        type: "json_schema",
        jsonSchema: { name: params.schemaName, strict: true, schema: toStrictJsonSchema(params.schema) },
      },
      provider: { dataCollection: "deny" },
      stream: false,
    },
  });

const extractContent = (result: ChatResult): Effect.Effect<string, SnapchefServerError> =>
  fromNullable(result.choices[0]?.message.content).pipe(
    Effect.flatMap((content) =>
      match(content)
        .with(P.string, (content) => Effect.succeed(content))
        .with(P.nullish, () =>
          Effect.fail(new SnapchefExternalSystemError({ message: "OpenRouter returned no text content" })),
        )
        .otherwise(() =>
          Effect.fail(new SnapchefExternalSystemError({ message: "OpenRouter returned unexpected content" })),
        ),
    ),
  );

// Single typed transport over the OpenRouter SDK: chat completion with structured outputs +
// model fallback, then decode the model's JSON content against `schema`. Every failure mode —
// missing key, transport, no content, non-JSON, schema mismatch — surfaces as
// SnapchefExternalSystemError (500), never SnapchefValidationError (model output is an external
// contract, not user input).
const completeStructured = <S extends z.ZodType>(params: {
  messages: ChatMessages[];
  schema: S;
  schemaName: string;
}): Effect.Effect<z.output<S>, SnapchefServerError> =>
  client.pipe(
    Effect.flatMap((client) =>
      Effect.tryPromise({
        try: () => sendChatRequest(client, params),
        catch: asExternal("OpenRouter request failed"),
      }).pipe(
        Effect.flatMap(extractContent),
        Effect.flatMap((content) =>
          Effect.try({ try: () => JSON.parse(content) as unknown, catch: asExternal("Model output was not JSON") }),
        ),
        Effect.flatMap((parsed) =>
          decodeWith(params.schema)(parsed).pipe(Effect.mapError(asExternal("Model output did not match schema"))),
        ),
      ),
    ),
  );

const recognizePhoto = (url: string): Effect.Effect<RecognizedItem[], SnapchefServerError> =>
  completeStructured({
    messages: buildRecognitionMessages(url),
    schema: RecognizedItemsResult,
    schemaName: "recognized_items",
  }).pipe(Effect.map((result) => result.items));

const mergeItems = (lists: RecognizedItem[]): Effect.Effect<RecognizedItem[], SnapchefServerError> =>
  completeStructured({
    messages: buildMergeMessages(lists),
    schema: RecognizedItemsResult,
    schemaName: "merged_items",
  }).pipe(Effect.map((result) => result.items));

export const createProductRecognizer = (): ProductRecognizer => ({
  recognizePhoto,
  mergeItems,
});
