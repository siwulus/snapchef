import { RecipeSession, StoredPhoto } from "@/lib/core/model/recipe";
import { PhotoRow, RecipeSessionRow } from "@/lib/infrastructure/db/types/index";

export const RecipeSessionFromRow = RecipeSessionRow.transform((row) => ({
  id: row.id,
  userId: row.user_id,
  correctedItems: row.corrected_items,
  createdAt: row.created_at,
  mealContext: row.meal_context,
  recognizedItems: row.recognized_items,
  state: row.state,
  updatedAt: row.updated_at,
})).pipe(RecipeSession);

export const PhotoFromRow = PhotoRow.transform((row) => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  storagePath: row.storage_path,
  storageObjectId: row.storage_object_id,
  contentType: row.content_type,
  sizeBytes: row.size_bytes,
  originalFilename: row.original_filename,
  recognizedItems: row.recognized_items,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})).pipe(StoredPhoto);
