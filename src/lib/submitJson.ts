import type { ApiResult } from "@/types";

export const submitJson = async (url: string, data: unknown): Promise<ApiResult> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(data),
  });

  if (response.status !== 200 && response.status !== 400) {
    throw new Error(`Unexpected server response: ${response.status.toString()}`);
  }

  return response.json() as Promise<ApiResult>;
};
