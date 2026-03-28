const BASE_URL = import.meta.env.VITE_SAKURA_AI_BASE_URL || "https://api.ai.sakura.ad.jp/v1";
const API_KEY = import.meta.env.VITE_SAKURA_AI_API_KEY || "";

export class SakuraAIError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "SakuraAIError";
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  responseType?: "json" | "blob";
  signal?: AbortSignal;
}

export async function sakuraFetch<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = "POST", body, headers = {}, responseType = "json", signal } = options;

  if (!API_KEY) {
    throw new SakuraAIError(
      "API key is not configured. Please set VITE_SAKURA_AI_API_KEY in your .env file.",
      401,
      "MISSING_API_KEY",
    );
  }

  const url = `${BASE_URL}${endpoint}`;

  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    Accept: responseType === "blob" ? "audio/wav" : "application/json",
    ...headers,
  };

  if (body && !(body instanceof FormData)) {
    requestHeaders["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
      signal,
    });

    if (!response.ok) {
      let errorMessage = `API request failed with status ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }
      throw new SakuraAIError(errorMessage, response.status);
    }

    if (responseType === "blob") {
      return (await response.blob()) as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof SakuraAIError) {
      throw error;
    }
    throw new SakuraAIError(
      `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      undefined,
      "NETWORK_ERROR",
    );
  }
}

export function isApiConfigured(): boolean {
  return !!API_KEY;
}
