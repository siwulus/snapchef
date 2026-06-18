import { RecipeDisplay } from "@/components/recipes/wizard/RecipeDisplay";
import { ReviewStep } from "@/components/recipes/wizard/ReviewStep";
import { UploadStep } from "@/components/recipes/wizard/UploadStep";
import { WizardExitLink } from "@/components/recipes/wizard/WizardExitLink";
import type { RecognitionResult } from "@/lib/core/boundry/recipe";
import type { Recipe } from "@/lib/core/model/recipe";
import { useEffect, useRef, useState } from "react";

type Step = "upload" | "review" | "recipe";

// Orchestrates the "create new recipe" flow: owns the step machine, the upload→review handoff
// payload, the generated recipe, and the leave-guard. Each step renders itself (UploadStep /
// ReviewStep / RecipeDisplay) — this component only decides which one is shown.
const RecipeWizard = () => {
  const [step, setStep] = useState<Step>("upload");
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
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

  const handleGenerated = (generatedRecipe: Recipe) => {
    setRecipe(generatedRecipe);
    setStep("recipe");
  };

  const renderStep = () => {
    if (step === "upload" || !result) {
      return <UploadStep onComplete={handleRecognitionComplete} onDirtyChange={setDirty} />;
    }

    if (step === "recipe" && recipe) {
      return <RecipeDisplay recipe={recipe} onBeforeNavigate={disarmLeaveGuard} />;
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
    </div>
  );
};

export default RecipeWizard;
