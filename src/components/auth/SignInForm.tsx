import { IconField } from "@/components/auth/IconField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import ResendConfirmation from "@/components/auth/ResendConfirmation";
import { ServerError } from "@/components/auth/ServerError";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { useApiClient } from "@/components/hooks/useApiClient";
import { useZodForm } from "@/components/hooks/useZodForm";
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RedirectTarget } from "@/lib/core/boundry/auth";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { Effect } from "effect";
import { Lock, LogIn, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import z from "zod";

const SignInFormModel = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type SignInFormModel = z.infer<typeof SignInFormModel>;

const SignInForm = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [notConfirmed, setNotConfirmed] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);

  const form = useZodForm(SignInFormModel, { email: "", password: "" });
  const { post } = useApiClient();

  useEffect(() => {
    if (pendingRedirect) window.location.href = pendingRedirect;
  }, [pendingRedirect]);

  const onSubmit = async (data: SignInFormModel) =>
    Effect.sync(() => {
      setServerMessage(null);
      setNotConfirmed(false);
    }).pipe(
      Effect.flatMap(() => post("/api/auth/signin", data, RedirectTarget)),
      Effect.tap(handleSubmitResponse),
      Effect.runPromise,
    );

  const handleSubmitResponse = (result: ApiResponsePayload<RedirectTarget>): Effect.Effect<void> =>
    Effect.sync(() => {
      if (result.ok) {
        setPendingRedirect(result.data.redirect);
      } else if (result.error.name === "SnapchefEmailNotConfirmedError") {
        // Unconfirmed email: show a clear message + inline resend instead of the raw server error.
        setNotConfirmed(true);
        setServerMessage(
          "Please confirm your email address before signing in — use the button below to resend the link.",
        );
      } else {
        if (result.error.fieldErrors) {
          Object.entries(result.error.fieldErrors).forEach(([field, message]) => {
            if (message) form.setError(field as keyof SignInFormModel, { message });
          });
        }
        if (result.error.message) {
          setServerMessage(result.error.message);
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
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <IconField
                field={field}
                type={showPassword ? "text" : "password"}
                placeholder="Your password"
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
            </FormItem>
          )}
        />

        <ServerError message={serverMessage} />

        {notConfirmed && <ResendConfirmation defaultEmail={form.getValues("email")} />}

        <SubmitButton
          pendingText="Signing in..."
          icon={<LogIn className="size-4" />}
          isSubmitting={form.formState.isSubmitting}
        >
          Sign in
        </SubmitButton>
      </form>
    </Form>
  );
};

export default SignInForm;
