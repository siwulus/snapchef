import type { SessionPhotoStorage, StoredObject } from "@/lib/core/boundry/recipe";
import type { UserId } from "@/lib/core/model/auth";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { Database } from "@/lib/infrastructure/db/types";
import { tryErrorData } from "@/lib/utils/effect";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect } from "effect";

const STORAGE_BUCKET = "session-photos";
const PREVIEW_URL_TTL_SECONDS = 30 * 60;

// Path convention {user_id}/{session_id}/{uuid}.{ext} — the first segment is the owner's
// user_id, which the storage RLS policies key on (storage.foldername(name))[1] = auth.uid().
const buildPath = (userId: UserId, sessionId: string, file: File) => {
  const ext = file.name.split(".").pop() ?? "bin";
  return `${userId}/${sessionId}/${crypto.randomUUID()}.${ext}`;
};

const upload =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId, sessionId: string, file: File): Effect.Effect<StoredObject, SnapchefServerError> => {
    const path = buildPath(userId, sessionId, file);
    return tryErrorData(() =>
      supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false })
        .then(({ error, data }) => ({ error, data })),
    ).pipe(Effect.map((data) => ({ path: data.path, objectId: data.id, fullPath: data.fullPath })));
  };

const createPreviewUrls =
  (supabase: SupabaseClient<Database>) =>
  (paths: string[]): Effect.Effect<{ path: string; previewUrl: string }[], SnapchefServerError> =>
    tryErrorData(() =>
      supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrls(paths, PREVIEW_URL_TTL_SECONDS)
        .then(({ error, data }) => ({ error, data })),
    ).pipe(
      Effect.map((entries) =>
        entries.flatMap((entry) =>
          entry.signedUrl && entry.path ? [{ path: entry.path, previewUrl: entry.signedUrl }] : [],
        ),
      ),
    );

const remove =
  (supabase: SupabaseClient<Database>) =>
  (paths: string[]): Effect.Effect<void, SnapchefServerError> =>
    tryErrorData(() =>
      supabase.storage
        .from(STORAGE_BUCKET)
        .remove(paths)
        .then(({ error, data }) => ({ error, data })),
    ).pipe(Effect.asVoid);

export const createSessionPhotoStorage = (supabase: SupabaseClient<Database>): SessionPhotoStorage => ({
  upload: upload(supabase),
  createPreviewUrls: createPreviewUrls(supabase),
  remove: remove(supabase),
});
