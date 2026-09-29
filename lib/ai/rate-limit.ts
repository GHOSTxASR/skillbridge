import { NextResponse } from "next/server"
import type { createSupabaseServerClient } from "@/lib/supabase-server"

// Per-user admission control for AI generations (P1.8). A route calls admitGeneration()
// only when it is about to ask Groq for something new: a cache miss, an explicit
// ?refresh=1 or a chat message. Cache hits never call it, so they never use an allowance.
//
// The counting happens in Postgres (public.consume_ai_generation, see
// supabase/migrations/20260922180000_p1_ai_rate_limits.sql), atomically and per signed-in
// user, so every server instance shares the same counts. The limits live in that function:
//
//   operation         per 10 minutes   per hour
//   chat                    20             60      every /api/ai generation
//   career_analysis          5             15      /api/ai/career-analysis
//   learning                 3             10      /api/learning
//
// An admitted request stays counted even if Groq then fails, so failing requests cannot
// be repeated without limit. When the check itself fails, nothing is sent to Groq: the
// route answers as it does for any unavailable AI (its fallback or saved result).

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export type AIOperation = "chat" | "career_analysis" | "learning"

export type Admission =
  | { allowed: true }
  | { allowed: false; reason: "rate_limited"; retryAfterSeconds: number }
  | { allowed: false; reason: "unavailable" }

// The longest window is one hour; anything longer is not a value this limiter produces.
const MAX_RETRY_AFTER_SECONDS = 3600

function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
}

export async function admitGeneration(
  supabase: ServerClient,
  operation: AIOperation
): Promise<Admission> {
  try {
    const { data, error } = await supabase.rpc("consume_ai_generation", {
      p_operation: operation,
    })

    if (error) {
      console.error("AI rate limit check failed:", {
        operation,
        code: error.code ?? "unknown",
      })
      return { allowed: false, reason: "unavailable" }
    }

    if (isPlainObject(data) && data.allowed === true) {
      return { allowed: true }
    }

    if (
      isPlainObject(data) &&
      data.allowed === false &&
      typeof data.retry_after_seconds === "number" &&
      Number.isFinite(data.retry_after_seconds)
    ) {
      const retryAfterSeconds = Math.min(
        MAX_RETRY_AFTER_SECONDS,
        Math.max(1, Math.ceil(data.retry_after_seconds))
      )

      console.warn("AI generation limit reached:", {
        operation,
        retryAfterSeconds,
      })

      return { allowed: false, reason: "rate_limited", retryAfterSeconds }
    }

    console.error("AI rate limit check returned an unexpected result:", {
      operation,
    })
    return { allowed: false, reason: "unavailable" }
  } catch {
    console.error("AI rate limit check failed:", { operation, code: "exception" })
    return { allowed: false, reason: "unavailable" }
  }
}

// HTTP 429 for a request the per-user limit refused. This is not Groq's own rate limit,
// which routes still report as a 200 fallback with reason "rate_limited".
export function rateLimitedResponse(
  retryAfterSeconds: number,
  body: Record<string, unknown> = {}
) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))

  return NextResponse.json(
    {
      ...body,
      error: "rate_limited",
      message: `You've reached the AI request limit. Please try again in ${minutes} ${
        minutes === 1 ? "minute" : "minutes"
      }.`,
      retryAfterSeconds,
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    }
  )
}
