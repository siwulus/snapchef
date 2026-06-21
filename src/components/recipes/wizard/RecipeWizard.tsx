import { PhotoUploader } from "@/components/recipes/photo/PhotoUploader";
import { GeneratedRecipeView } from "@/components/recipes/wizard/GeneratedRecipeView";
import { WizardReviewProducts } from "@/components/recipes/wizard/WizardReviewProducts";
import { WizardActions } from "@/components/recipes/wizard/WizardActions";
import { WizardExitLink } from "@/components/recipes/wizard/WizardExitLink";
import type { PhotoView, RecipeGenerationResult, RecognitionResult } from "@/lib/core/boundry/recipe";
import type { Recipe, RecipeSession } from "@/lib/core/model/recipe";
import { useEffect, useRef, useState } from "react";

type Step = "upload" | "review" | "recipe";

// Orchestrates the "create new recipe" flow. Its state is divided into three explicit slices, each
// from the backend: the `session` (the durable handle + the persisted items / meal context / off-
// list toggle), the uploaded `photos`, and the generated `recipe`. Plus the step machine and the
// leave-guard. Each step renders itself (UploadStep / ReviewStep / GeneratedRecipeView) — this
// component only decides which one is shown and renders the shared chrome (back link, heading,
// action row). Recognition and generation responses are destructured into these slices at the
// handoff boundaries; no slice is reconstructed from a command snapshot or a bundle reach-in.
const RecipeWizard = () => {
  const [step, setStep] = useState<Step>("upload");
  const [session, setSession] = useState<RecipeSession | null>(null);
  const [photos, setPhotos] = useState<PhotoView[]>([]);
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
    setSession(recognitionResult.session);
    setPhotos(recognitionResult.photos);
    setStep("review");
  };

  const handleGenerated = (result: RecipeGenerationResult) => {
    setSession(result.session);
    setRecipe(result.recipe);
    setStep("recipe");
  };

  const renderStep = () => {
    if (step === "upload" || session === null) {
      return <PhotoUploader onComplete={handleRecognitionComplete} onDirtyChange={setDirty} />;
    }

    if (step === "review") {
      return <WizardReviewProducts session={session} photos={photos} onGenerated={handleGenerated} />;
    }

    if (recipe) {
      return <GeneratedRecipeView recipe={recipe} photos={photos} session={session} />;
    }

    return null;
  };

  return (
    <div className="flex flex-col gap-6">
      <WizardExitLink dirty={dirty} onBeforeNavigate={disarmLeaveGuard} />
      <div>
        <h1 className="text-foreground text-2xl font-semibold">{recipe?.name ?? "Nowy przepis"}</h1>
        <p className="text-muted-foreground mt-1 text-sm">Prześlij od 1 do 5 zdjęć produktów, aby rozpocząć.</p>
      </div>
      {renderStep()}
      {session ? (
        <WizardActions
          sessionId={session.id}
          onBeforeNavigate={disarmLeaveGuard}
          showSave={step === "recipe" && !!recipe}
        />
      ) : null}
    </div>
  );
};

export default RecipeWizard;
