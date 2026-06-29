import { cn } from "@/styles/utils";
import { Camera, ChefHat, ListChecks, type LucideIcon } from "lucide-react";

type Step = "upload" | "review" | "recipe";

interface WizardStepperProps {
  current: Step;
  // True when the user may jump to `step` (it has been reached). The wizard owns the reachability rule.
  canNavigate: (step: Step) => boolean;
  onNavigate: (step: Step) => void;
  // Busy gate: while an upload/recognition/generation is in flight, every step is non-interactive.
  disabled?: boolean;
}

interface StepDescriptor {
  step: Step;
  label: string;
  Icon: LucideIcon;
}

const STEPS: StepDescriptor[] = [
  { step: "upload", label: "Zdjęcia", Icon: Camera },
  { step: "review", label: "Produkty", Icon: ListChecks },
  { step: "recipe", label: "Przepis", Icon: ChefHat },
];

// Horizontal 3-step indicator for the new-recipe wizard. Reached steps (canNavigate) are clickable to
// jump back/forward; the current step is highlighted (aria-current); unreached steps — and every step
// while an operation is in flight (`disabled`) — are non-interactive. Hand-rolled: shadcn has no stepper.
export const WizardStepper = ({ current, canNavigate, onNavigate, disabled = false }: WizardStepperProps) => (
  <nav aria-label="Kroki tworzenia przepisu">
    <ol className="flex items-center gap-2">
      {STEPS.map(({ step, label, Icon }, index) => {
        const isCurrent = step === current;
        const isReachable = canNavigate(step) && !disabled;
        return (
          <li key={step} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onNavigate(step);
              }}
              disabled={!isReachable}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isCurrent ? "bg-primary/10 text-primary" : "text-muted-foreground",
                isReachable && !isCurrent && "hover:text-foreground hover:bg-muted",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-xs",
                  isCurrent ? "border-primary text-primary" : "border-muted-foreground/40",
                )}
              >
                {index + 1}
              </span>
              <Icon aria-hidden className="size-4" />
              {label}
            </button>
            {index < STEPS.length - 1 ? <span aria-hidden className="bg-border h-px w-6" /> : null}
          </li>
        );
      })}
    </ol>
  </nav>
);
