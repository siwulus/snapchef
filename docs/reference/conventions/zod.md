# Zod Conventions

## Rule: Schema and inferred type must share the same name

Export the Zod schema and its inferred TypeScript type under the same identifier. Use `z.infer<typeof SomeType>` — the `const` and `type` coexist because TypeScript keeps value and type namespaces separate.

```ts
// ✓ good
export const SignIn = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type SignIn = z.infer<typeof SignIn>;
```

```ts
// ✗ bad
export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type SignInInput = z.infer<typeof signInSchema>;
```

> **Why the same name works:** TypeScript resolves `SomeType` as a value (the Zod schema object) in value positions and as a type (the inferred shape) in type positions. They don't collide.

> **For schemas built with `.refine()` or `.extend()`:** The base/intermediate schema is unexported and can use any internal name. Only the final exported schema + type pair must match.

```ts
// ✓ good — refine case
const SignUpBase = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  confirmPassword: z.string().min(1),
});

export const SignUp = SignUpBase.refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export type SignUp = z.infer<typeof SignUp>;
```

---

## Rule: Derive write payloads from the model with `.pick().partial()`

When a payload is a subset of a domain model (an update DTO, a patch), derive it from the model schema with `.pick({...})` (+ `.partial()` for optional fields) instead of re-declaring the fields. The derived schema + type keep the same-name convention. This lives next to the port that uses it (e.g. `core/boundry/recipe/ports.ts`).

```ts
// ✓ good — the update payload is the model, narrowed; it tracks the model automatically
export const RecipeSessionUpdatePayload = RecipeSession.pick({
  correctedItemsMd: true,
  mealContext: true,
  recognizedItemsMd: true,
  state: true,
  photoPaths: true,
}).partial();

export type RecipeSessionUpdatePayload = z.infer<typeof RecipeSessionUpdatePayload>;
```

```ts
// ✗ bad — re-declaring the fields; drifts from RecipeSession the moment the model changes
export const RecipeSessionUpdatePayload = z.object({
  correctedItemsMd: z.string().optional(),
  mealContext: z.string().optional(),
  // …copy-paste of the model, now a second source of truth
});
```

---

## Rule: Map persistence rows to domain models with a `…FromRow` transform decoder

DB rows are snake_case; domain models are camelCase. Bridge them with a zod **transform decoder**: an unexported `…RowSchema` (the raw row shape) → `.transform(row => ({ …camelCase }))` → `.pipe(Model)` so the output is re-validated against the domain schema. Export only the final decoder, named `<Model>FromRow` (the unexported row schema may use any internal name — same exception as `.refine()`/`.extend()` above). Run it through `decodeWith` (see `effect.md`); adapters never return a raw row.

```ts
// ✓ good — src/lib/utils/recipe.ts: row schema (private) → transform → re-validate as the model
const RecipeSessionRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  corrected_items_md: z.string().nullable(),
  // …the rest of the snake_case columns
});

export const RecipeSessionFromRow = RecipeSessionRowSchema.transform((row) => ({
  id: row.id,
  userId: row.user_id,
  correctedItemsMd: row.corrected_items_md,
  // …camelCase the rest
})).pipe(RecipeSession);
```

> **Why `.pipe(Model)` at the end:** the transform reshapes keys, but piping into the domain schema re-checks the values (enums, uuids, nullability), so a row that no longer fits the model fails loudly at the boundary instead of leaking a malformed object into the domain.
