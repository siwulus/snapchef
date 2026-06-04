import type { ApiResult } from "@/lib/infrastructure/api/types";

export const submitJson = async <T>(url: string, data: T): Promise<ApiResult<T>> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(data),
  });

  if (response.status !== 200 && response.status !== 400) {
    throw new Error(`Unexpected server response: ${response.status.toString()}`);
  }

  return response.json() as Promise<ApiResult<T>>;
};
