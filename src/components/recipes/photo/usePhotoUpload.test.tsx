// @vitest-environment jsdom
import { usePhotoUpload } from "@/components/recipes/photo/usePhotoUpload";
import type { RecognitionResult } from "@/lib/core/boundry/recipe";
import type { RecipeSession } from "@/lib/core/model/recipe";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Record the URLs the transport is hit with, branching the envelope per endpoint.
const mocks = vi.hoisted(() => ({ postCalls: [] as string[], formDataCalls: [] as string[] }));

const session: RecipeSession = {
  id: "11111111-2222-3333-4444-555555555555",
  userId: "22222222-3333-4444-5555-666666666666",
  correctedItems: null,
  createdAt: "2026-06-16T00:00:00.000Z",
  mealContext: null,
  allowExtraIngredients: null,
  recognizedItems: null,
  state: "photos_uploaded",
  updatedAt: "2026-06-16T00:00:00.000Z",
};

const recognitionResult: RecognitionResult = {
  session: {
    ...session,
    state: "products_recognized",
    recognizedItems: [{ name: "Mleko", quantity: "1 l", context: "" }],
  },
  photos: [],
};

// prepareForUpload uses createImageBitmap (absent in jsdom); stub it to pass files straight through.
vi.mock("@/components/recipes/photo/photo-processing", () => ({
  prepareForUpload: (file: File) => Promise.resolve(file),
}));

// Stub the client hook so no real fetch runs; record the URLs and branch the envelope per endpoint.
vi.mock("@/components/hooks/useApiClient", async () => {
  const { Effect } = await import("effect");
  return {
    useApiClient: () => ({
      post: (url: string) => {
        mocks.postCalls.push(url);
        if (url.endsWith("/recognition")) return Effect.succeed({ ok: true, data: recognitionResult });
        return Effect.succeed({ ok: true, data: session });
      },
      postFormData: (url: string) => {
        mocks.formDataCalls.push(url);
        return Effect.succeed({ ok: true, data: session });
      },
      del: () => Effect.never,
    }),
  };
});

const CREATE_URL = "/api/recipe-sessions";
const UPLOAD_URL = `/api/recipe-sessions/${session.id}/upload`;
const RECOGNITION_URL = `/api/recipe-sessions/${session.id}/recognition`;
const makeFile = () => new File(["x"], "a.jpg", { type: "image/jpeg" });

beforeEach(() => {
  mocks.postCalls = [];
  mocks.formDataCalls = [];
});

describe("usePhotoUpload session reuse", () => {
  it("creates a session when none exists, then uploads + recognizes against the new id", async () => {
    const onComplete = vi.fn<(result: RecognitionResult) => void>();
    const { result } = renderHook(() => usePhotoUpload(onComplete, null));

    act(() => {
      result.current.submit([makeFile()]);
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(mocks.postCalls).toContain(CREATE_URL);
    expect(mocks.formDataCalls).toEqual([UPLOAD_URL]);
  });

  it("reuses an existing session — no create POST, uploads to the existing id", async () => {
    const onComplete = vi.fn<(result: RecognitionResult) => void>();
    const { result } = renderHook(() => usePhotoUpload(onComplete, session));

    act(() => {
      result.current.submit([makeFile()]);
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(mocks.postCalls).not.toContain(CREATE_URL);
    expect(mocks.formDataCalls).toEqual([UPLOAD_URL]);
    // The only POST is the recognition trigger — no session-create call.
    expect(mocks.postCalls).toEqual([RECOGNITION_URL]);
  });
});
