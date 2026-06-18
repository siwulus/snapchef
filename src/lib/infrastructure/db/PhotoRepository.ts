import type { PhotoCreatePayload, PhotoRepository } from "@/lib/core/boundry/recipe";
import type { UserId } from "@/lib/core/model/auth";
import type { SnapchefServerError } from "@/lib/core/model/error";
import { Photo, type RecognizedItem, type StoredPhoto } from "@/lib/core/model/recipe";
import type { Database } from "@/lib/infrastructure/db/types";
import { PhotoFromRow } from "@/lib/infrastructure/db/types/converters";
import { decodeWith, tryErrorData, tryErrorDataOption, tryErrorDataWithSchema } from "@/lib/utils/effect";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect } from "effect";
import { isEmpty } from "ramda";
import z from "zod";

// Mirrors SessionPhotoStorage's bucket/TTL (re-declared rather than imported — the storage
// adapter is a separate port and the URL generation here belongs to the read path).
const STORAGE_BUCKET = "session-photos";
const PREVIEW_URL_TTL_SECONDS = 30 * 60;

const create =
  (supabase: SupabaseClient<Database>) =>
  (payload: PhotoCreatePayload): Effect.Effect<StoredPhoto, SnapchefServerError> =>
    tryErrorDataWithSchema(PhotoFromRow)(() =>
      supabase
        .from("photos")
        .insert({
          session_id: payload.sessionId,
          user_id: payload.userId,
          storage_path: payload.storagePath,
          storage_object_id: payload.storageObjectId,
          content_type: payload.contentType,
          size_bytes: payload.sizeBytes,
          original_filename: payload.originalFilename,
        })
        .select("*")
        .single()
        .then(({ error, data }) => ({ error, data })),
    );

// Index signed-URL results by storage path, dropping entries Supabase failed to sign.
const toUrlByPath = (entries: { path?: string | null; signedUrl?: string | null }[]): Map<string, string> =>
  new Map(
    entries
      .filter((entry): entry is { path: string; signedUrl: string } => Boolean(entry.path && entry.signedUrl))
      .map((entry) => [entry.path, entry.signedUrl] as const),
  );

// Batch-generate signed URLs and index them by storage path. This is the literal
// realization of "Photo.photoUrl populated during fetch by the infrastructure layer".
const signUrlsByPath =
  (supabase: SupabaseClient<Database>) =>
  (paths: string[]): Effect.Effect<Map<string, string>, SnapchefServerError> =>
    isEmpty(paths)
      ? Effect.succeed(new Map<string, string>())
      : tryErrorData(() =>
          supabase.storage
            .from(STORAGE_BUCKET)
            .createSignedUrls(paths, PREVIEW_URL_TTL_SECONDS)
            .then(({ error, data }) => ({ error, data })),
        ).pipe(Effect.map(toUrlByPath));

// Decode stored photos into domain Photos, populating each photoUrl from a batch of signed URLs.
// Keep a photo whose signed URL is missing (empty photoUrl) so the UI can render a fallback.
const withSignedUrls =
  (supabase: SupabaseClient<Database>) =>
  (stored: StoredPhoto[]): Effect.Effect<Photo[], SnapchefServerError> =>
    signUrlsByPath(supabase)(stored.map((photo) => photo.storagePath)).pipe(
      Effect.flatMap((urlByPath) =>
        Effect.forEach(stored, (photo) =>
          decodeWith(Photo)({ ...photo, photoUrl: urlByPath.get(photo.storagePath) ?? "" }),
        ),
      ),
    );

const listBySession =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId, sessionId: string): Effect.Effect<Photo[], SnapchefServerError> =>
    tryErrorDataWithSchema(z.array(PhotoFromRow))(() =>
      supabase
        .from("photos")
        .select("*")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
        .then(({ error, data }) => ({ error, data })),
    ).pipe(Effect.flatMap(withSignedUrls(supabase)));

const updateRecognizedItems =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId, photoId: string, items: RecognizedItem[]): Effect.Effect<StoredPhoto, SnapchefServerError> =>
    tryErrorDataWithSchema(PhotoFromRow)(() =>
      supabase
        .from("photos")
        .update({ recognized_items: items })
        .eq("id", photoId)
        .eq("user_id", userId)
        .select("*")
        .single()
        .then(({ error, data }) => ({ error, data })),
    );

const deleteBySession =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId, sessionId: string): Effect.Effect<void, SnapchefServerError> =>
    tryErrorDataOption(() =>
      supabase
        .from("photos")
        .delete()
        .eq("session_id", sessionId)
        .eq("user_id", userId)
        .then(({ error, data }) => ({ error, data })),
    ).pipe(Effect.asVoid);

export const createPhotoRepository = (supabase: SupabaseClient<Database>): PhotoRepository => ({
  create: create(supabase),
  listBySession: listBySession(supabase),
  updateRecognizedItems: updateRecognizedItems(supabase),
  deleteBySession: deleteBySession(supabase),
});
