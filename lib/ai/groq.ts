const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

const DEFAULT_MODEL = "llama-3.1-8b"

type GroqResult = {
  text: string
  keyIndex: number
  model: string
  finishReason: string | null
}

// Why a call produced no usable text. The keys share one Groq organisation quota, so
// "rate_limited" means that quota is used up, not just one key.
export type GroqFailure =
  | "not_configured"
  | "rate_limited"
  | "invalid_key"
  | "bad_request"
  | "empty"
  | "unavailable"

export type GroqChatOutcome =
  | { ok: true; result: GroqResult }
  | { ok: false; reason: GroqFailure }

export type GroqJSONOutcome =
  | { ok: true; data: unknown; model: string }
  | {
      ok: false
      reason: GroqFailure | "truncated" | "invalid_json"
    }

type ChatOptions = {
  temperature?: number
  maxTokens?: number
  // gpt-oss models spend part of max_completion_tokens on hidden reasoning; lower effort
  // leaves more of it for the answer. Only sent to gpt-oss models, which document it.
  reasoningEffort?: "low" | "medium" | "high"
}

type GroqError = Error & {
  status?: number
  retryMs?: number
  empty?: boolean
}

// Per key: only an invalid or unauthorised key is taken out of rotation.
type KeyState = {
  unavailableUntil: number
}

const states: KeyState[] = [
  { unavailableUntil: 0 },
  { unavailableUntil: 0 },
  { unavailableUntil: 0 },
]

const INVALID_KEY_PAUSE_MS = 5 * 60 * 1000

// Groq rate limits apply to the whole organisation, and every configured key belongs to
// it, so a 429 pauses all keys until Groq's Retry-After. This state lives in one server
// process (a dev server or one serverless instance); it is not shared between instances.
let rateLimitedUntil = 0

function getKeys(): string[] {
  return [
    process.env.GROQ_API_KEY?.trim() || "",
    process.env.GROQ_API_KEY_1?.trim() || "",
    process.env.GROQ_API_KEY_2?.trim() || "",
  ].filter(Boolean)
}

function getModel(): string {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL
}

// The model requests are sent to, for callers that key caches on it.
export function groqModel(): string {
  return getModel()
}

// Groq's Retry-After in ms, clamped to 1 s - 2 min; 30 s when it is missing or unusable.
function retryDelay(response: Response): number {
  const retryAfter = response.headers.get("retry-after")
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter)
    if (Number.isFinite(seconds)) {
      return Math.min(Math.max(seconds * 1000, 1000), 120000)
    }
  }
  return 30000
}

function extractText(data: any): string {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === "string" && content.trim()) {
    return content.trim()
  }
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim()
  }
  return ""
}

async function callKey(
  key: string,
  keyIndex: number,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options?: ChatOptions
): Promise<GroqResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: getModel(),
        messages,
        temperature: options?.temperature ?? 0.3,
        max_completion_tokens: options?.maxTokens ?? 2048,
        ...(options?.reasoningEffort &&
        getModel().startsWith("openai/gpt-oss")
          ? { reasoning_effort: options.reasoningEffort }
          : {}),
        stream: false,
      }),
      signal: controller.signal,
      cache: "no-store",
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      const error = new Error(`Groq ${response.status}: ${errorSummary(body)}`) as GroqError
      error.status = response.status
      if (response.status === 429) {
        error.retryMs = retryDelay(response)
      }
      throw error
    }

    const data = await response.json()
    const text = extractText(data)
    if (!text) {
      const error = new Error("Groq returned an empty response") as GroqError
      error.empty = true
      throw error
    }
    const finishReason = data?.choices?.[0]?.finish_reason
    return {
      text,
      keyIndex,
      model: getModel(),
      finishReason: typeof finishReason === "string" ? finishReason : null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

// Only the error code and a short message: a Groq error body can echo generated text.
function errorSummary(body: string): string {
  try {
    const error = JSON.parse(body)?.error
    const code = error?.code ?? error?.type ?? "error"
    const message = typeof error?.message === "string" ? error.message : ""
    return `${code}: ${message.slice(0, 200)}`
  } catch {
    return body.slice(0, 200)
  }
}

export async function groqChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options?: ChatOptions
): Promise<GroqResult | null> {
  const outcome = await groqChatOutcome(messages, options)
  return outcome.ok ? outcome.result : null
}

// groqChat that reports why no text came back. At most one request per key, and only an
// invalid or unauthorised key moves on to the next one: every other failure (rate limit,
// server or network error, empty reply, rejected request) would repeat on any key, since
// they share one organisation. There is no automatic retry; callers show their fallback.
export async function groqChatOutcome(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options?: ChatOptions
): Promise<GroqChatOutcome> {
  const keys = getKeys()
  if (keys.length === 0) {
    console.error("No Groq API keys configured.")
    return { ok: false, reason: "not_configured" }
  }

  const now = Date.now()

  // While the organisation quota is exhausted, send nothing.
  if (rateLimitedUntil > now) {
    return { ok: false, reason: "rate_limited" }
  }

  // Keys already paused as invalid count as invalid if nothing else is tried.
  let reason: GroqFailure = "invalid_key"

  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]
    if (!key) continue
    if (states[index] && states[index].unavailableUntil > now) continue

    try {
      const result = await callKey(key, index, messages, options)
      if (states[index]) {
        states[index].unavailableUntil = 0
      }
      return { ok: true, result }
    } catch (error) {
      const typed = error as GroqError
      console.error(`Groq key ${index + 1} failed:`, typed.message)

      if (typed.status === 401 || typed.status === 403) {
        if (states[index]) {
          states[index].unavailableUntil = Date.now() + INVALID_KEY_PAUSE_MS
        }
        reason = "invalid_key"
        continue
      }

      if (typed.status === 429) {
        rateLimitedUntil = Date.now() + (typed.retryMs ?? 30000)
        reason = "rate_limited"
      } else if (typed.empty) {
        reason = "empty"
      } else if (
        typed.status !== undefined &&
        typed.status >= 400 &&
        typed.status < 500 &&
        typed.status !== 408 &&
        typed.status !== 409 &&
        typed.status !== 425
      ) {
        reason = "bad_request"
      } else {
        reason = "unavailable"
      }

      return { ok: false, reason }
    }
  }

  return { ok: false, reason }
}

export async function groqJSON<T>(system: string, user: string, fallback: T): Promise<T> {
  const outcome = await groqJSONOutcome(system, user)
  return outcome.ok ? (outcome.data as T) : fallback
}

// groqJSON without a fallback value: reports why no JSON came back, so callers can tell a
// genuine AI result from a failure instead of receiving their fallback object.
export async function groqJSONOutcome(
  system: string,
  user: string,
  options?: Pick<ChatOptions, "reasoningEffort">
): Promise<GroqJSONOutcome> {
  const outcome = await groqChatOutcome(
    [
      { role: "system", content: system + "\nReturn ONLY valid JSON. Do not use markdown fences." },
      { role: "user", content: user },
    ],
    { temperature: 0.1, maxTokens: 3000, ...options }
  )

  if (!outcome.ok) {
    return outcome
  }

  const { text, model, finishReason } = outcome.result

  try {
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim()
    return { ok: true, data: JSON.parse(cleaned), model }
  } catch (error) {
    // Never log the model output itself, only what is needed to diagnose the failure.
    console.error("Groq JSON parse failed:", {
      model,
      finishReason,
      length: text.length,
      error: error instanceof Error ? error.name : "unknown",
    })
    return {
      ok: false,
      reason: finishReason === "length" ? "truncated" : "invalid_json",
    }
  }
}

export function aiAvailable(): boolean {
  return Boolean(
    process.env.GROQ_API_KEY?.trim() ||
    process.env.GROQ_API_KEY_1?.trim() ||
    process.env.GROQ_API_KEY_2?.trim()
  )
}
