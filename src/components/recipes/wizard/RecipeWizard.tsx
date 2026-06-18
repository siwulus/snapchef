import { GeneratedRecipeView } from "@/components/recipes/wizard/GeneratedRecipeView";
import { ReviewStep } from "@/components/recipes/wizard/ReviewStep";
import { UploadStep } from "@/components/recipes/wizard/UploadStep";
import { WizardActions } from "@/components/recipes/wizard/WizardActions";
import { WizardExitLink } from "@/components/recipes/wizard/WizardExitLink";
import type { RecipeGenerationCommand, RecognitionResult } from "@/lib/core/boundry/recipe";
import type { Recipe } from "@/lib/core/model/recipe";
import { useEffect, useRef, useState } from "react";

type Step = "upload" | "review" | "recipe";

// Orchestrates the "create new recipe" flow: owns the step machine, the upload→review handoff
// payload, the generated recipe + the command snapshot it was generated from, and the leave-guard.
// Each step renders itself (UploadStep / ReviewStep / GeneratedRecipeView) — this component only
// decides which one is shown and renders the shared chrome (back link, heading, action row).
const RecipeWizard = () => {
  const [step, setStep] = useState<Step>("upload");
  const [result, setResult] = useState<RecognitionResult | null>(null);
  // The generated recipe together with the command it was generated from — the command carries the
  // items / meal context / off-list toggle the read-only final-step summary echoes (the Recipe
  // model itself does not).
  const [generated, setGenerated] = useState<{ recipe: Recipe; command: RecipeGenerationCommand } | null>(null);
  const [dirty, setDirty] = useState(false);
  // Ref-backed armed flag so the finalize flow can disarm the guard SYNCHRONOUSLY before
  // window.location.assign — a deferred setDirty(false) would not flush before the browser
  // reads the beforeunload handler.
  const guardArmed = useRef(false);

  // Leave-guard: warn before navigating away once photos have been selected (unsaved work).
  useEffect(() => {
    guardArmed.current = dirty;
    if (!dirty) return;
    // preventDefault() is the modern trigger for the browser's leave-prompt; the deprecated
    // returnValue assignment is intentionally omitted. The handler honors the synchronous
    // guardArmed flag so an intentional finalize navigation can suppress the prompt.
    const handler = (event: BeforeUnloadEvent) => {
      if (guardArmed.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [dirty]);

  const disarmLeaveGuard = () => {
    guardArmed.current = false;
  };

  const handleRecognitionComplete = (recognitionResult: RecognitionResult) => {
    setResult(recognitionResult);
    setStep("review");
  };

  const handleGenerated = (recipe: Recipe, command: RecipeGenerationCommand) => {
    setGenerated({ recipe, command });
    setStep("recipe");
  };

  const renderStep = () => {
    if (step === "upload" || !result) {
      return <UploadStep onComplete={handleRecognitionComplete} onDirtyChange={setDirty} />;
    }

    if (step === "recipe" && generated) {
      return <GeneratedRecipeView recipe={generated.recipe} photos={result.photos} command={generated.command} />;
    }

    return <ReviewStep result={result} onGenerated={handleGenerated} />;
  };

  return (
    <div className="flex flex-col gap-6">
      <WizardExitLink dirty={dirty} onBeforeNavigate={disarmLeaveGuard} />
      <div>
        <h1 className="text-foreground text-2xl font-semibold">Nowy przepis</h1>
        <p className="text-muted-foreground mt-1 text-sm">Prześlij od 1 do 5 zdjęć produktów, aby rozpocząć.</p>
      </div>
      {renderStep()}
      {result ? (
        <WizardActions
          sessionId={result.session.id}
          onBeforeNavigate={disarmLeaveGuard}
          showSave={step === "recipe" && !!generated}
        />
      ) : null}
    </div>
  );
};

export default RecipeWizard;
