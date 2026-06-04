import { IconField } from "@/components/auth/IconField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { ServerError } from "@/components/auth/ServerError";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { useApiClient } from "@/components/hooks/useApiClient";
import { useZodForm } from "@/components/hooks/useZodForm";
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RedirectTarget } from "@/lib/core/boundry/auth";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { Effect } from "effect";
import { Lock, Mail, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import z from "zod";

const SignUpFormModel = z
  .object({
    email: z.email("Enter a valid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignUpFormModel = z.infer<typeof SignUpFormModel>;

const MIN_PASSWORD_LENGTH = 6;

const SignUpForm = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);

  const form = useZodForm(SignUpFormModel, { email: "", password: "", confirmPassword: "" });
  const { post } = useApiClient();
  const password = form.watch("password");

  useEffect(() => {
    if (pendingRedirect) window.location.href = pendingRedirect;
  }, [pendingRedirect]);

  const passwordHint =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH
      ? `${String(MIN_PASSWORD_LENGTH - password.length)} more character${MIN_PASSWORD_LENGTH - password.length !== 1 ? "s" : ""} needed`
      : undefined;

  const onSubmit = async (data: SignUpFormModel) =>
    Effect.sync(() => {
      setServerMessage(null);
    }).pipe(
      Effect.flatMap(() => post("/api/auth/signup", { email: data.email, password: data.password }, RedirectTarget)),
      Effect.tap(handleSubmitResponse),
      Effect.runPromise,
    );

  const handleSubmitResponse = (result: ApiResponsePayload<RedirectTarget>): Effect.Effect<void> =>
    Effect.sync(() => {
      if (result.ok) {
        setPendingRedirect(result.data.redirect);
      } else {
        if (result.fieldErrors) {
          Object.entries(result.fieldErrors).forEach(([field, message]) => {
            if (message) form.setError(field as keyof SignUpFormModel, { message });
          });
        }
        if (result.message) {
          setServerMessage(result.message);
        }
      }
    });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <IconField field={field} type="email" placeholder="you@example.com" icon={<Mail className="size-4" />} />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <IconField
                field={field}
                type={showPassword ? "text" : "password"}
                placeholder="Min. 6 characters"
                icon={<Lock className="size-4" />}
                endContent={
                  <PasswordToggle
                    visible={showPassword}
                    onToggle={() => {
                      setShowPassword(!showPassword);
                    }}
                  />
                }
              />
              <FormMessage />
              {!fieldState.error && passwordHint && (
                <p className="text-muted-foreground mt-1 text-xs">{passwordHint}</p>
              )}
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password</FormLabel>
              <IconField
                field={field}
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Re-enter your password"
                icon={<Lock className="size-4" />}
                endContent={
                  <PasswordToggle
                    visible={showConfirmPassword}
                    onToggle={() => {
                      setShowConfirmPassword(!showConfirmPassword);
                    }}
                  />
                }
              />
              <FormMessage />
            </FormItem>
          )}
        />

        <ServerError message={serverMessage} />

        <SubmitButton
          pendingText="Creating account..."
          icon={<UserPlus className="size-4" />}
          isSubmitting={form.formState.isSubmitting}
        >
          Create account
        </SubmitButton>
      </form>
    </Form>
  );
};

export default SignUpForm;
