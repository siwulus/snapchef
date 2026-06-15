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
import { KeyRound, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import z from "zod";

const ResetPasswordFormModel = z
  .object({
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ResetPasswordFormModel = z.infer<typeof ResetPasswordFormModel>;

interface ResetPasswordFormProps {
  // The recovery token_hash from the emailed link, carried from the callback page. Redemption happens
  // here on submit (POST) — never on the page GET — so a single-use token isn't burned by prefetchers.
  tokenHash: string;
}

const ResetPasswordForm = ({ tokenHash }: ResetPasswordFormProps) => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);

  const form = useZodForm(ResetPasswordFormModel, { newPassword: "", confirmPassword: "" });
  const { post } = useApiClient();

  useEffect(() => {
    if (pendingRedirect) window.location.href = pendingRedirect;
  }, [pendingRedirect]);

  const onSubmit = async (data: ResetPasswordFormModel) =>
    Effect.sync(() => {
      setServerMessage(null);
      setLinkInvalid(false);
    }).pipe(
      Effect.flatMap(() =>
        post("/api/auth/reset-password", { tokenHash, newPassword: data.newPassword }, RedirectTarget),
      ),
      Effect.tap(handleSubmitResponse),
      Effect.runPromise,
    );

  const handleSubmitResponse = (result: ApiResponsePayload<RedirectTarget>): Effect.Effect<void> =>
    Effect.sync(() => {
      if (result.ok) {
        setPendingRedirect(result.data.redirect);
      } else if (result.error.name === "SnapchefBusinessRuleViolationError" || result.error.fieldErrors) {
        // Weak password (422) or field-level validation (400): surface on the field / as a server
        // message — NOT the "link expired" copy.
        if (result.error.fieldErrors) {
          Object.entries(result.error.fieldErrors).forEach(([field, message]) => {
            if (message && (field === "newPassword" || field === "confirmPassword")) {
              form.setError(field, { message });
            }
          });
        }
        if (result.error.message) {
          setServerMessage(result.error.message);
        }
      } else {
        // 401 (invalid/expired/used token) and anything else: offer a fresh reset.
        setLinkInvalid(true);
        setServerMessage("This reset link is invalid or has expired — request a new one.");
      }
    });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
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
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <IconField
                field={field}
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Re-enter your new password"
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

        {linkInvalid && (
          <a
            href="/auth/forgot-password"
            className="text-foreground hover:text-muted-foreground block text-center text-sm underline underline-offset-4"
          >
            Request a new reset link
          </a>
        )}

        <SubmitButton
          pendingText="Saving..."
          icon={<KeyRound className="size-4" />}
          isSubmitting={form.formState.isSubmitting}
        >
          Set new password
        </SubmitButton>
      </form>
    </Form>
  );
};

export default ResetPasswordForm;
