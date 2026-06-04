import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";

export const submitJson = async <TRes>(url: string, data: unknown): Promise<ApiResponsePayload<TRes>> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(data),
  });

  return response.json() as Promise<ApiResponsePayload<TRes>>;
};
