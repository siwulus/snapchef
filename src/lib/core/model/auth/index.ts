import { z } from "zod";

export const UserId = z.uuid();
export type UserId = z.infer<typeof UserId>;

export const SnapchefUser = z.object({
  id: UserId,
  email: z.email().optional(),
});

export type SnapchefUser = z.infer<typeof SnapchefUser>;
