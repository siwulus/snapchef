import type { ProductRecognizer, RecipeGenerator } from "@/lib/core/boundry/recipe";
import { SnapchefExternalSystemError, type SnapchefServerError } from "@/lib/core/model/error";
import { RecognizedItem } from "@/lib/core/model/recipe";
import { decodeWith, fromNullable, logResult } from "@/lib/utils/effect";
import { OpenRouter } from "@openrouter/sdk";
import { ChatFinishReasonEnum } from "@openrouter/sdk/models";
import type { ChatMessages, ChatResult } from "@openrouter/sdk/models";
import {
  OPENROUTER_API_KEY,
  OPENROUTER_RECIPE_FALLBACK_MODEL,
  OPENROUTER_RECIPE_MODEL,
  OPENROUTER_RECOGNITION_FALLBACK_MODEL,
  OPENROUTER_RECOGNITION_MODEL,
} from "astro:env/server";
import { Effect } from "effect";
import { z } from "zod";
import { buildMergeMessages, buildRecipeMessages, buildRecognitionMessages } from "./prompts";
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
  params: {
    messages: ChatMessages[];
    schema: z.ZodType;
    schemaName: string;
    models: [string, string];
    temperature?: number;
    maxTokens?: number;
  },
): Promise<ChatResult> =>
  client.chat.send({
    chatRequest: {
      models: params.models,
      messages: params.messages,
      responseFormat: {
        type: "json_schema",
        jsonSchema: { name: params.schemaName, strict: true, schema: toStrictJsonSchema(params.schema) },
      },
      provider: { dataCollection: "deny" },
      stream: false,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    },
  });

// Guard the completion before any JSON.parse: a response cut at max_tokens (finishReason "length")
// is unparseable mid-JSON, and a refusal carries no usable content. Both surface as a clear
// SnapchefExternalSystemError so the UC-layer retry is meaningful and the logs are legible.
const guardCompletion = (result: ChatResult): Effect.Effect<ChatResult, SnapchefServerError> =>
  match(result.choices[0])
    .with({ finishReason: ChatFinishReasonEnum.Length }, () =>
      Effect.fail(new SnapchefExternalSystemError({ message: "Model output truncated" })),
    )
    .with({ message: { refusal: P.string } }, (choice) =>
      Effect.fail(new SnapchefExternalSystemError({ message: `Model refused: ${choice.message.refusal}` })),
    )
    .otherwise(() => Effect.succeed(result));

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
// model fallback (model pair + optional sampling per use case), guard truncation/refusal, then
// decode the model's JSON content against `schema`. Every failure mode — missing key, transport,
// truncation, refusal, no content, non-JSON, schema mismatch — surfaces as
// SnapchefExternalSystemError (500), never SnapchefValidationError (model output is an external
// contract, not user input).
const completeStructured = <S extends z.ZodType>(params: {
  messages: ChatMessages[];
  schema: S;
  schemaName: string;
  models: [string, string];
  temperature?: number;
  maxTokens?: number;
}): Effect.Effect<z.output<S>, SnapchefServerError> =>
  client.pipe(
    Effect.flatMap((client) =>
      Effect.tryPromise({
        try: () => sendChatRequest(client, params),
        catch: asExternal("OpenRouter request failed"),
      }).pipe(
        Effect.flatMap(guardCompletion),
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

const RECOGNITION_MODELS: [string, string] = [OPENROUTER_RECOGNITION_MODEL, OPENROUTER_RECOGNITION_FALLBACK_MODEL];

const recognizePhoto = (url: string): Effect.Effect<RecognizedItem[], SnapchefServerError> =>
  completeStructured({
    messages: buildRecognitionMessages(url),
    schema: RecognizedItemsResult,
    schemaName: "recognized_items",
    models: RECOGNITION_MODELS,
  }).pipe(
    Effect.map((result) => result.items),
    logResult("llm.recognize"),
  );

const mergeItems = (lists: RecognizedItem[]): Effect.Effect<RecognizedItem[], SnapchefServerError> =>
  completeStructured({
    messages: buildMergeMessages(lists),
    schema: RecognizedItemsResult,
    schemaName: "merged_items",
    models: RECOGNITION_MODELS,
  }).pipe(
    Effect.map((result) => result.items),
    logResult("llm.merge"),
  );

export const createProductRecognizer = (): ProductRecognizer => ({
  recognizePhoto,
  mergeItems,
});

// The model returns { name, content }; the adapter maps content → contentMd so the port speaks
// the domain's vocabulary. temperature 0.7 / maxTokens 2000 fit a single non-reasoning recipe.
const RecipeResult = z.object({
  name: z.string().min(1).max(200),
  content: z.string().min(1).max(16000),
});

const generate = (input: {
  items: RecognizedItem[];
  mealContext: string;
  allowExtraIngredients: boolean;
}): Effect.Effect<{ name: string; contentMd: string }, SnapchefServerError> =>
  completeStructured({
    messages: buildRecipeMessages(input),
    schema: RecipeResult,
    schemaName: "generated_recipe",
    models: [OPENROUTER_RECIPE_MODEL, OPENROUTER_RECIPE_FALLBACK_MODEL],
    temperature: 0.7,
    maxTokens: 2000,
  }).pipe(
    Effect.map((result) => ({ name: result.name, contentMd: result.content })),
    logResult("llm.recipe"),
  );

export const createRecipeGenerator = (): RecipeGenerator => ({
  generate,
});
