import { z } from "zod";

export const SignInCommand = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type SignInCommand = z.infer<typeof SignInCommand>;

export const SignUpCommand = z
  .object({
    email: z.email("Enter a valid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignUpCommand = z.infer<typeof SignUpCommand>;
