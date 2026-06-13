import { UploadStep } from "@/components/recipes/wizard/UploadStep";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { RecipeSession } from "@/lib/core/model/recipe";
import { useEffect, useState } from "react";

type Step = "upload" | "review";

const RecipeWizard = () => {
  const [step, setStep] = useState<Step>("upload");
  // The current session is updated from every API response; the recognized markdown is held
  // separately so the customer can edit it freely (no formatting — it's a plain bullet list).
  const [, setSession] = useState<RecipeSession | null>(null);
  const [recognizedItemsMd, setRecognizedItemsMd] = useState("");
  const [dirty, setDirty] = useState(false);

  // Leave-guard: warn before navigating away once photos have been selected (unsaved work).
  useEffect(() => {
    if (!dirty) return;
    // preventDefault() is the modern trigger for the browser's leave-prompt; the deprecated
    // returnValue assignment is intentionally omitted.
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [dirty]);

  const handleComplete = (recognizedSession: RecipeSession, markdown: string) => {
    setSession(recognizedSession);
    setRecognizedItemsMd(markdown);
    setStep("review");
  };

  if (step === "upload") {
    return <UploadStep onComplete={handleComplete} onDirtyChange={setDirty} />;
  }

  // The recognized items are plain markdown (a `- {name} — {quantity}` list); present them in a
  // simple editable textarea. Edits stay client-side (S-01 scope — no persistence).
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rozpoznane produkty</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Label htmlFor="recognized-items">Sprawdź i popraw listę produktów</Label>
        <Textarea
          id="recognized-items"
          value={recognizedItemsMd}
          onChange={(event) => {
            setRecognizedItemsMd(event.target.value);
          }}
          rows={Math.max(6, recognizedItemsMd.split("\n").length + 1)}
          placeholder="Nie rozpoznano żadnych produktów."
        />
      </CardContent>
    </Card>
  );
};

export default RecipeWizard;
