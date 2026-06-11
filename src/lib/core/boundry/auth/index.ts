import { z } from "zod";

export * from "./ports";

export const RedirectTarget = z.object({
  redirect: z.string(),
});

export type RedirectTarget = z.infer<typeof RedirectTarget>;
