import { z } from "zod";
import { RecognizedItem } from "@/lib/core/model/recipe";

// Driving-side input shared by the React generation form and the API route: the edited product
// list, the user's free-text meal context, and the off-list-ingredients toggle.
export const RecipeGenerationCommand = z.object({
  correctedItems: z.array(RecognizedItem).min(1),
  mealContext: z.string().max(2000),
  allowExtraIngredients: z.boolean(),
});

export type RecipeGenerationCommand = z.infer<typeof RecipeGenerationCommand>;
