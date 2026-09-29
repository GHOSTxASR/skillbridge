import { NextResponse } from "next/server"
import { MAX_BODY_LENGTH } from "@/lib/skills/validation"

// Shared by the /api/skills routes.

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

export type BodyResult = { ok: true; body: unknown } | { ok: false; response: NextResponse }

export async function readJsonBody(request: Request): Promise<BodyResult> {
  const raw = await request.text()
  if (raw.length > MAX_BODY_LENGTH) {
    return { ok: false, response: jsonError(413, "Request body too large") }
  }
  try {
    return { ok: true, body: JSON.parse(raw) }
  } catch {
    return { ok: false, response: jsonError(400, "Invalid JSON body") }
  }
}

type DbError = { code?: string; message?: string } | null | undefined

// The skill functions raise these codes with messages written for users (see the
// migration). Anything else is reported generically so constraint and table names do
// not leak.
export function dbErrorResponse(error: DbError, context: string) {
  switch (error?.code) {
    case "22023":
      return jsonError(400, error.message || "Invalid request")
    case "P0002":
      return jsonError(404, error.message || "Not found")
    case "42501":
      return jsonError(403, "Not allowed")
    case "55000":
    case "54000":
      return jsonError(409, error.message || "Not possible right now")
    case "23503":
      return jsonError(409, "Finish setting up your profile first")
    default:
      console.error(`${context} failed:`, error?.code ?? "unknown")
      return jsonError(500, "Something went wrong. Please try again.")
  }
}
