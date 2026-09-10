import { ASSISTANT_TOOLS } from "./tools";

// Two interchangeable LLM providers behind one normalized shape, so the
// route doesn't care which is active. Anthropic is the eventual target
// (better tool-use reliability) but has no permanent free tier; Gemini's
// Flash models do, at the cost of rate limits and slightly less reliable
// tool selection. Swap back once this is profitable enough to justify the
// cost — see ASSISTANT_PROVIDER below, nothing else needs to change.

export type NormalizedToolCall = { name: string; input: Record<string, any> };
export type ProviderResult = { toolCall: NormalizedToolCall | null; text: string };

// Gemini's function-declaration schema is OpenAPI-flavored with UPPERCASE
// type names, unlike Anthropic's (and JSON Schema's) lowercase ones — this
// converts our one canonical tool list (defined in Anthropic's shape in
// tools.ts) into Gemini's shape on the fly, so there's only ever one place
// that defines what the 4 tools actually are.
function toGeminiType(t: string): string {
  switch (t) {
    case "object": return "OBJECT";
    case "string": return "STRING";
    case "integer": return "INTEGER";
    case "number": return "NUMBER";
    case "boolean": return "BOOLEAN";
    case "array": return "ARRAY";
    default: return String(t).toUpperCase();
  }
}

function toGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  const { type, properties, items, ...rest } = schema;
  const converted: any = { ...rest };
  if (type) converted.type = toGeminiType(type);
  if (properties) {
    converted.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, toGeminiSchema(value)])
    );
  }
  if (items) converted.items = toGeminiSchema(items);
  return converted;
}

export async function callAnthropic(apiKey: string, systemPrompt: string, userMessage: string): Promise<ProviderResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      tools: ASSISTANT_TOOLS,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Anthropic request failed (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const content: any[] = data.content ?? [];
  const toolUseBlock = content.find((b) => b.type === "tool_use");
  const text = content.filter((b) => b.type === "text").map((b) => b.text).join(" ");

  return {
    toolCall: toolUseBlock ? { name: toolUseBlock.name, input: toolUseBlock.input } : null,
    text,
  };
}

// gemini-2.0-flash was retired — confirmed live against the API in
// September 2026 via its own 404 error, which named this replacement.
// generateContent (used below) is still fully supported for this model;
// Google's newer "Interactions API" is only the *preferred* surface for
// new projects, not a hard requirement — not worth migrating to yet.
const GEMINI_MODEL = "gemini-3.6-flash";

// Free-tier Gemini models get deprioritized under load and return a
// transient 503 ("currently experiencing high demand") fairly often — not
// an error in our request, just Google's infra shedding load. Worth a
// couple of quick automatic retries before surfacing it as a failure,
// since the free tier is the whole point of running this provider.
const RETRYABLE_STATUSES = new Set([503, 429]);
const RETRY_DELAYS_MS = [500, 1500];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callGemini(apiKey: string, systemPrompt: string, userMessage: string): Promise<ProviderResult> {
  const requestBody = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    tools: [
      {
        function_declarations: ASSISTANT_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: toGeminiSchema(tool.input_schema),
        })),
      },
    ],
  });

  let res: Response;
  let attempt = 0;
  while (true) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: requestBody }
    );

    if (res.ok || !RETRYABLE_STATUSES.has(res.status) || attempt >= RETRY_DELAYS_MS.length) break;
    await sleep(RETRY_DELAYS_MS[attempt]);
    attempt++;
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Gemini request failed (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
  const functionCallPart = parts.find((p) => p.functionCall);
  const text = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join(" ");

  return {
    toolCall: functionCallPart
      ? { name: functionCallPart.functionCall.name, input: functionCallPart.functionCall.args ?? {} }
      : null,
    text,
  };
}

export type AssistantProvider = "gemini" | "anthropic";

export function getActiveProvider(): AssistantProvider {
  const raw = (process.env.ASSISTANT_PROVIDER ?? "gemini").toLowerCase();
  return raw === "anthropic" ? "anthropic" : "gemini";
}

export function getProviderApiKeyEnvVar(provider: AssistantProvider): string {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
}

export function callProvider(
  provider: AssistantProvider,
  apiKey: string,
  systemPrompt: string,
  userMessage: string
): Promise<ProviderResult> {
  return provider === "anthropic"
    ? callAnthropic(apiKey, systemPrompt, userMessage)
    : callGemini(apiKey, systemPrompt, userMessage);
}
