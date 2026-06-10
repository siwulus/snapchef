import type { UserId } from "@/lib/core/model/auth";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { SessionPhotoStorage } from "@/lib/core/boundry/recipe";
import { tryErrorData } from "@/lib/utils/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect } from "effect";
import type { Database } from "./types";

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
  (userId: UserId, sessionId: string, file: File): Effect.Effect<string, SnapchefServerError> => {
    const path = buildPath(userId, sessionId, file);
    return tryErrorData(() =>
      supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false })
        .then(({ error, data }) => ({ error, data })),
    ).pipe(Effect.map(({ path }) => path));
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

export const createSessionPhotoStorage = (supabase: SupabaseClient<Database>): SessionPhotoStorage => ({
  upload: upload(supabase),
  createPreviewUrls: createPreviewUrls(supabase),
});
