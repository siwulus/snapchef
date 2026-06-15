import { ServerError } from "@/components/auth/ServerError";
import { useApiClient } from "@/components/hooks/useApiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmationResent } from "@/lib/core/boundry/auth";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { Effect } from "effect";
import { CheckCircle2, Send } from "lucide-react";
import { useState } from "react";

interface ResendConfirmationProps {
  // When provided (e.g. embedded in the sign-in form), the email is fixed and only a button shows.
  // When omitted (the confirm-email page), the user types the address into an input.
  defaultEmail?: string;
}

const ResendConfirmation = ({ defaultEmail }: ResendConfirmationProps) => {
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { post } = useApiClient();

  const fixedEmail = defaultEmail !== undefined;

  const handleResponse = (result: ApiResponsePayload<ConfirmationResent>): Effect.Effect<void> =>
    Effect.sync(() => {
      if (result.ok) {
        setSuccessMessage(`A fresh confirmation link is on its way to ${result.data.email}.`);
      } else {
        setErrorMessage(result.error.fieldErrors?.email ?? result.error.message);
      }
    });

  // Framework-edge handler: one Effect pipeline, one runPromise. State mutations live in Effect.sync.
  // useApiClient already toasts transport failures, so catchAll just keeps the button handler from
  // rejecting; envelope (ok: false) errors are surfaced inline above.
  const handleResend = async () =>
    Effect.sync(() => {
      setSuccessMessage(null);
      setErrorMessage(null);
      setIsSubmitting(true);
    }).pipe(
      Effect.flatMap(() => post("/api/auth/resend", { email }, ConfirmationResent)),
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
      {!fixedEmail && (
        <Input
          type="email"
          placeholder="you@example.com"
          value={email}
          aria-label="Email"
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      )}

      <Button type="button" className="w-full" disabled={isSubmitting || email.length === 0} onClick={handleResend}>
        <span className="flex items-center gap-2">
          <Send className="size-4" />
          {isSubmitting ? "Sending..." : "Resend confirmation email"}
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

export default ResendConfirmation;
