import { z } from "zod";

export const RedirectTarget = z.object({
  redirect: z.string(),
});

export type RedirectTarget = z.infer<typeof RedirectTarget>;
