import { ServerError } from "@/components/auth/ServerError";
import { useApiClient } from "@/components/hooks/useApiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordResetRequested } from "@/lib/core/boundry/auth";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { Effect } from "effect";
import { CheckCircle2, Send } from "lucide-react";
import { useState } from "react";

// Request a password-reset email. Modeled on ResendConfirmation: one Effect pipeline, one runPromise,
// inline neutral success / error. The success message never discloses whether the account exists
// (anti-enumeration) — the route always echoes the submitted address back.
const ForgotPasswordForm = () => {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { post } = useApiClient();

  const handleResponse = (result: ApiResponsePayload<PasswordResetRequested>): Effect.Effect<void> =>
    Effect.sync(() => {
      if (result.ok) {
        setSuccessMessage(`If an account exists for ${result.data.email}, a password reset link is on its way.`);
      } else {
        setErrorMessage(result.error.fieldErrors?.email ?? result.error.message);
      }
    });

  // Framework-edge handler: one Effect pipeline, one runPromise. State mutations live in Effect.sync.
  // useApiClient already toasts transport failures, so catchAll just keeps the handler from rejecting;
  // envelope (ok: false) errors are surfaced inline above.
  const handleSubmit = async () =>
    Effect.sync(() => {
      setSuccessMessage(null);
      setErrorMessage(null);
      setIsSubmitting(true);
    }).pipe(
      Effect.flatMap(() => post("/api/auth/forgot-password", { email }, PasswordResetRequested)),
      Effect.tap(handleResponse),
      Effect.catchAll(() => Effect.void),
      Effect.ensuring(
        Effect.sync(() => {
          setIsSubmitting(false);
        }),
      ),
      Effect.runPromise,
    );

  return (
    <div className="space-y-3">
      <Input
        type="email"
        placeholder="you@example.com"
        value={email}
        aria-label="Email"
        onChange={(event) => {
          setEmail(event.target.value);
        }}
      />

      <Button type="button" className="w-full" disabled={isSubmitting || email.length === 0} onClick={handleSubmit}>
        <span className="flex items-center gap-2">
          <Send className="size-4" />
          {isSubmitting ? "Sending..." : "Send reset link"}
        </span>
      </Button>

      {successMessage && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CheckCircle2 className="text-foreground size-4 shrink-0" />
          {successMessage}
        </p>
      )}

      <ServerError message={errorMessage} />
    </div>
  );
};

export default ForgotPasswordForm;
