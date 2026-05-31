import { useState, useEffect } from "react";
import { Mail, Lock, LogIn } from "lucide-react";
import { toast } from "sonner";
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { IconField } from "@/components/auth/IconField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { useZodForm } from "@/components/hooks/useZodForm";
import { submitJson } from "@/lib/submitJson";
import { signInSchema } from "@/lib/validation/auth";
import type { SignInInput } from "@/lib/validation/auth";

export default function SignInForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);

  const form = useZodForm(signInSchema, { email: "", password: "" });

  useEffect(() => {
    if (pendingRedirect) window.location.href = pendingRedirect;
  }, [pendingRedirect]);

  async function onSubmit(data: SignInInput) {
    setServerMessage(null);
    try {
      const result = await submitJson("/api/auth/signin", data);
      if (result.ok) {
        setPendingRedirect(result.redirect ?? "/recipes");
      } else {
        if (result.fieldErrors) {
          for (const [field, message] of Object.entries(result.fieldErrors)) {
            if (message) form.setError(field as "email" | "password", { message });
          }
        }
        if (result.message) {
          setServerMessage(result.message);
        }
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    }
  }

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
}
