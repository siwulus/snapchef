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
