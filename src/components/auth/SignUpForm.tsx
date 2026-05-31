import { useState, useEffect } from "react";
import { Mail, Lock, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { IconField } from "@/components/auth/IconField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { useZodForm } from "@/components/hooks/useZodForm";
import { submitJson } from "@/lib/submitJson";
import { SignUp } from "@/lib/validation/auth";
import type { SignUp as SignUpType } from "@/lib/validation/auth";

const MIN_PASSWORD_LENGTH = 6;

const SignUpForm = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);

  const form = useZodForm(SignUp, { email: "", password: "", confirmPassword: "" });
  const password = form.watch("password");

  useEffect(() => {
    if (pendingRedirect) window.location.href = pendingRedirect;
  }, [pendingRedirect]);

  const passwordHint =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH
      ? `${String(MIN_PASSWORD_LENGTH - password.length)} more character${MIN_PASSWORD_LENGTH - password.length !== 1 ? "s" : ""} needed`
      : undefined;

  const onSubmit = async (data: SignUpType) => {
    setServerMessage(null);
    try {
      const result = await submitJson("/api/auth/signup", { email: data.email, password: data.password });
      if (result.ok) {
        setPendingRedirect(result.redirect ?? "/auth/confirm-email");
      } else {
        if (result.fieldErrors) {
          Object.entries(result.fieldErrors).forEach(([field, message]) => {
            if (message) form.setError(field as "email" | "password", { message });
          });
        }
        if (result.message) {
          setServerMessage(result.message);
        }
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    }
  };

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
