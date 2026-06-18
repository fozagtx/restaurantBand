export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
};

export type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export type ChatCompletionOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  maxAttempts?: number;
  requestTimeoutMs?: number;
};

export async function createChatCompletion(options: ChatCompletionOptions): Promise<string> {
  if (!options.apiKey) {
    throw new Error("Missing API key for OpenAI-compatible chat completion.");
  }
  let lastError = "";
  const maxAttempts = options.maxAttempts ?? 5;
  const requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages,
          temperature: options.temperature ?? 0.4,
          max_tokens: options.maxTokens ?? 1600
        }),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeout);
      lastError = `Chat completion request failed: ${formatTransportError(error)}`;
      if (attempt < maxAttempts && isRetryableTransportFailure(error)) {
        await sleep(retryDelayMs(attempt, lastError));
        continue;
      }
      throw new Error(lastError);
    } finally {
      clearTimeout(timeout);
    }
    const bodyText = await response.text();
    if (!response.ok) {
      lastError = `Chat completion failed (${response.status}): ${bodyText}`;
      if (attempt < maxAttempts && isRetryableFailure(response.status, bodyText)) {
        await sleep(retryDelayMs(attempt, bodyText));
        continue;
      }
      throw new Error(lastError);
    }
    const data = JSON.parse(bodyText) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Chat completion returned no text content.");
    }
    return content.trim();
  }
  throw new Error(lastError || "Chat completion failed after retries.");
}

function isRetryableFailure(status: number, bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return status === 429 || status >= 500 || lower.includes("busy") || lower.includes("try again later");
}

function retryDelayMs(attempt: number, bodyText: string): number {
  const lower = bodyText.toLowerCase();
  const baseDelay = lower.includes("busy") || lower.includes("try again later") ? 2500 : 1200;
  return Math.min(15000, baseDelay * 2 ** (attempt - 1));
}

function isRetryableTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  return error.name === "AbortError" || error.name === "TimeoutError" || error.name === "TypeError";
}

function formatTransportError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseJsonObject<T>(text: string): T | null {
  const candidates = extractJsonObjectCandidates(text);
  for (const candidate of candidates.reverse()) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }
  return null;
}

function extractJsonObjectCandidates(text: string): string[] {
  const objects: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    const end = findJsonObjectEnd(text, start);
    if (end !== -1) objects.push(text.slice(start, end + 1));
  }
  return objects;
}

function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}
