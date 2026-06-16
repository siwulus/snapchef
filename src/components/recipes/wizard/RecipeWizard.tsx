import { RecipeDisplay } from "@/components/recipes/wizard/RecipeDisplay";
import { ReviewStep } from "@/components/recipes/wizard/ReviewStep";
import { UploadStep } from "@/components/recipes/wizard/UploadStep";
import type { RecipeView, RecognitionResult } from "@/lib/core/boundry/recipe";
import { useEffect, useState } from "react";

type Step = "upload" | "review" | "recipe";

// Orchestrates the "create new recipe" flow: owns the step machine, the upload→review handoff
// payload, the generated recipe, and the leave-guard. Each step renders itself (UploadStep /
// ReviewStep / RecipeDisplay) — this component only decides which one is shown.
const RecipeWizard = () => {
  const [step, setStep] = useState<Step>("upload");
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [recipe, setRecipe] = useState<RecipeView | null>(null);
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

  const handleRecognitionComplete = (recognitionResult: RecognitionResult) => {
    setResult(recognitionResult);
    setStep("review");
  };

  const handleGenerated = (generatedRecipe: RecipeView) => {
    setRecipe(generatedRecipe);
    setStep("recipe");
  };

  if (step === "upload" || !result) {
    return <UploadStep onComplete={handleRecognitionComplete} onDirtyChange={setDirty} />;
  }

  if (step === "recipe" && recipe) {
    return <RecipeDisplay recipe={recipe} />;
  }

  return <ReviewStep result={result} onGenerated={handleGenerated} />;
};

export default RecipeWizard;
