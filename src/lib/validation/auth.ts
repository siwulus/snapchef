import { z } from "zod";

export const SignIn = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const SignUpBase = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
});

export const SignUp = SignUpBase.refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export const SignUpServer = z.object({
  email: z.email(),
  password: z.string().min(6),
});

export type SignIn = z.infer<typeof SignIn>;
export type SignUp = z.infer<typeof SignUp>;
export type SignUpServer = z.infer<typeof SignUpServer>;
