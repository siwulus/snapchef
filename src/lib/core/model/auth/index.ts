import { z } from "zod";

export const UserCredentials = z.object({
  email: z.email(),
  password: z.string().min(6),
});

export type UserCredentials = z.infer<typeof UserCredentials>;
