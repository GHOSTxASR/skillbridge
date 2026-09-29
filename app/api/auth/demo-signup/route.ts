import { NextResponse } from "next/server"
import { createDemoUser, isDemoAuthEnabled } from "@/lib/auth/demo-signup"
import { EXISTS_MESSAGE, parseDemoSignup } from "@/lib/auth/flow"
import { readJsonBody } from "@/lib/skills/http"

// TEMPORARY SIH demo sign-up (SKILLBRIDGE_DEMO_AUTH=true). See lib/auth/demo-signup.ts.
//
// GET  -> { enabled }: whether the login page should offer demo sign-up.
// POST { email, password, name } -> 201 { created: true } | 409 exists | 400 | 429 | 500.
//        404 when demo mode is off, so the page falls back to the email-code sign-up.
// The response never contains the password, a user id or a session: the page signs in with
// the normal password sign-in afterwards.

// Best-effort limit on account creation, per server instance: per client IP and in total.
const WINDOW_MS = 10 * 60 * 1000
const PER_IP = 10
const IN_TOTAL = 200
const created: { ip: string; at: number }[] = []

function allow(ip: string, now: number) {
  while (created.length && now - created[0].at > WINDOW_MS) created.shift()
  return created.length < IN_TOTAL && created.filter((entry) => entry.ip === ip).length < PER_IP
}

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown"
}

const failure = (status: number, error: string, code: string) => NextResponse.json({ error, code }, { status })

export async function GET() {
  return NextResponse.json({ enabled: isDemoAuthEnabled() })
}

export async function POST(request: Request) {
  if (!isDemoAuthEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const read = await readJsonBody(request)
  if (!read.ok) return read.response
  const parsed = parseDemoSignup(read.body)
  if (!parsed.ok) return failure(400, parsed.error, "invalid")

  const ip = clientIp(request)
  const now = Date.now()
  if (!allow(ip, now)) return failure(429, "Too many accounts were created from here recently. Please try again in a few minutes.", "rate_limited")

  const result = await createDemoUser(parsed.value)
  switch (result.kind) {
    case "created":
      created.push({ ip, at: now })
      return NextResponse.json({ created: true }, { status: 201 })
    case "exists":
      return failure(409, EXISTS_MESSAGE, "exists")
    case "rejected":
      return failure(400, result.message, "invalid")
    default:
      return failure(500, "Your account couldn't be created. Please try again.", "error")
  }
}
