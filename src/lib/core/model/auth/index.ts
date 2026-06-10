import { z } from "zod";

export const UserCredentials = z.object({
  email: z.email(),
  password: z.string().min(6),
});

export type UserCredentials = z.infer<typeof UserCredentials>;

export const UserId = z.uuid();
export type UserId = z.infer<typeof UserId>;

export const SnapchefUser = z.object({
  id: UserId,
  email: z.email().optional(),
});

export type SnapchefUser = z.infer<typeof SnapchefUser>;
