import "server-only"
import { createClient } from "@supabase/supabase-js"

// TEMPORARY SIH demo sign-up: creates an account without email verification. Off unless
// SKILLBRIDGE_DEMO_AUTH is exactly "true" (and SUPABASE_SECRET_KEY is set). With it off,
// sign-up uses the normal one-time email code. See docs/auth-email-verification.md.
//
// Supabase keeps "Confirm email" on, so an unverified account could not sign in. The account
// is therefore created with the admin API and marked confirmed, which Supabase requires for
// sign-in. That is NOT proof of email ownership: every such account also gets
// app_metadata.skillbridge_demo_auth = true, which only the server can set, so demo accounts
// can be told apart, re-verified or removed later.
//
// Server-only; imported only by app/api/auth/demo-signup/route.ts. The privileged client
// makes exactly one call: auth.admin.createUser. It never updates or deletes a user, so an
// existing account (and its password) is never touched. Failures are logged as a short code
// only, never the email, the password or the key.

export function isDemoAuthEnabled() {
  return process.env.SKILLBRIDGE_DEMO_AUTH === "true" && Boolean(process.env.SUPABASE_SECRET_KEY)
}

export type DemoSignupResult =
  | { kind: "created" }
  | { kind: "exists" }
  | { kind: "rejected"; message: string }
  | { kind: "failed" }

const safeCode = (code: unknown) => (typeof code === "string" && /^[a-z0-9_]{1,40}$/.test(code) ? code : "unknown")

export async function createDemoUser(input: { email: string; password: string; name: string }): Promise<DemoSignupResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!isDemoAuthEnabled() || !url || !key) return { kind: "failed" }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  try {
    const { error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name },
      app_metadata: { skillbridge_demo_auth: true },
    })
    if (!error) return { kind: "created" }
    if (error.code === "email_exists" || error.code === "user_already_exists") return { kind: "exists" }
    if (error.code === "weak_password" || error.code === "email_address_invalid" || error.code === "validation_failed") {
      return { kind: "rejected", message: error.message || "That email or password isn't accepted." }
    }
    console.error("Demo sign-up failed:", safeCode(error.code))
    return { kind: "failed" }
  } catch {
    console.error("Demo sign-up failed: request failed")
    return { kind: "failed" }
  }
}
