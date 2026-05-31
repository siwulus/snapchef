# How to Add a New Form

Forms in Snapchef use **react-hook-form + Zod + shadcn `Form`** primitives. This doc covers the full pattern and shows how file-upload and dynamic-array forms fit the same foundation.

> **Style note:** Examples here follow the coding conventions in [`docs/reference/conventions/`](./conventions/README.md) — same-name Zod schema+type, arrow functions over `function` keyword.

## 1. Define a Zod schema

Create or extend `src/lib/validation/<feature>.ts`. This file must import **only** `zod` — no Supabase, no `astro:env`, no service imports. Both the client island and the server route import it.

```ts
// src/lib/validation/recipe.ts
import { z } from "zod";

export const Recipe = z.object({
  title: z.string().min(1, "Title is required"),
  notes: z.string().optional(),
});

export type Recipe = z.infer<typeof Recipe>;
```

> Schema and type share the same name per [Zod conventions](./conventions/zod.md).

## 2. Build the form component

```tsx
// src/components/recipes/RecipeForm.tsx
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { IconField } from "@/components/auth/IconField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { useZodForm } from "@/components/hooks/useZodForm";
import { submitJson } from "@/lib/submitJson";
import { Recipe } from "@/lib/validation/recipe";
import type { Recipe as RecipeType } from "@/lib/validation/recipe";
import { BookOpen } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

const RecipeForm = () => {
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const form = useZodForm(Recipe, { title: "", notes: "" });

  const onSubmit = async (data: RecipeType) => {
    setServerMessage(null);
    try {
      const result = await submitJson("/api/recipes", data);
      if (result.ok) {
        window.location.href = result.redirect ?? "/recipes";
      } else {
        if (result.fieldErrors) {
          Object.entries(result.fieldErrors).forEach(([field, message]) => {
            if (message) form.setError(field as keyof RecipeType, { message });
          });
        }
        if (result.message) setServerMessage(result.message);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <IconField field={field} placeholder="Recipe title" icon={<BookOpen className="size-4" />} />
              <FormMessage />
            </FormItem>
          )}
        />
        <ServerError message={serverMessage} />
        <SubmitButton
          pendingText="Saving..."
          icon={<BookOpen className="size-4" />}
          isSubmitting={form.formState.isSubmitting}
        >
          Save
        </SubmitButton>
      </form>
    </Form>
  );
};

export default RecipeForm;
```

## 3. Write the API route

```ts
// src/pages/api/recipes/index.ts
export const prerender = false;

import type { APIRoute } from "astro";
import { Recipe } from "@/lib/validation/recipe";
import type { ApiResult } from "@/types";

export const POST: APIRoute = async ({ request, redirect: _ }) => {
  const body: unknown = await request.json();
  const parsed = Recipe.safeParse(body);

  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(
      Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0]]),
    );
    return Response.json({ ok: false, fieldErrors } satisfies ApiResult, { status: 400 });
  }

  // ... call service, handle errors ...

  return Response.json({ ok: true, redirect: "/recipes" } satisfies ApiResult);
};
```

### `ApiResult` shape (from `src/types.ts`)

| Case          | Shape                                                |
| ------------- | ---------------------------------------------------- |
| Success       | `{ ok: true; redirect?: string }`                    |
| Field error   | `{ ok: false; fieldErrors: Record<string, string> }` |
| General error | `{ ok: false; message: string }`                     |

`fieldErrors` keys must exactly match RHF field names so `form.setError(field, { message })` works without translation.

## 4. File upload (S-01)

Use `z.instanceof(File)` for a single file or iterate a `FileList`. Send via `FormData` instead of JSON (change `submitJson` to a `submitForm` helper that does `fetch(url, { method: "POST", body: formData })`). RHF's `register` or a controlled `<input type="file">` feeds the value into the schema.

```ts
export const Upload = z.object({
  photo: z.instanceof(File, { message: "Photo is required" }),
});

export type Upload = z.infer<typeof Upload>;
```

The API route reads `await request.formData()` instead of `request.json()`.

## 5. Dynamic arrays (S-01 recognized items)

Use RHF's `useFieldArray` for a list that grows/shrinks at runtime:

```tsx
import { useFieldArray } from "react-hook-form";

const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
```

The Zod schema uses `z.array(itemSchema)`. Server-side validation is unchanged — `safeParse` handles arrays natively.
