// Sign-up, email verification and onboarding rules shared by the login page and the app
// shell. Kept free of React and of the Supabase client so they can be tested on their own.
//
// Email verification uses Supabase's one-time code (OTP): the project's "Confirm signup"
// email template must contain {{ .Token }} (the code), not {{ .ConfirmationURL }} (a link).
// The code is checked in the browser with supabase.auth.verifyOtp({ email, token, type:
// "email" }), which also signs the user in. There is no link or callback route; see
// docs/auth-email-verification.md.

// Supabase lets a project choose an email code length from 6 to 10 digits.
export const CODE_MIN_LENGTH = 6
export const CODE_MAX_LENGTH = 10
export const RESEND_COOLDOWN_SECONDS = 60

// The email waiting for a code in this tab, so a refresh returns to the code screen.
export const PENDING_VERIFICATION_KEY = "skillbridge_pending_verification"

export const EXISTS_MESSAGE =
  "An account with this email already exists. Try signing in, or resend the verification email if the account isn't verified yet."

const GENERIC_MESSAGE = "Something went wrong. Please try again."

export function normalizeCode(input: string) {
  return input.replace(/\D/g, "").slice(0, CODE_MAX_LENGTH)
}

export function isCodeComplete(code: string) {
  return code.length >= CODE_MIN_LENGTH && code.length <= CODE_MAX_LENGTH && /^\d+$/.test(code)
}

type AuthErrorLike = { code?: string | null; status?: number | null; message?: string | null; name?: string | null } | null | undefined

// A Supabase auth error in the user's terms. Supabase's own messages are written for end
// users and are the fallback; the common cases get clearer wording.
export function authErrorMessage(error: AuthErrorLike): string {
  if (!error) return GENERIC_MESSAGE
  const message = typeof error.message === "string" ? error.message : ""
  const wait = message.match(/after (\d+) seconds?/i)

  if (wait) return `Please wait ${wait[1]} seconds before requesting another code.`
  switch (error.code) {
    case "otp_expired":
      return "That code is invalid or has expired. Check your most recent email, or send a new code."
    case "over_email_send_rate_limit":
      return "Too many emails have been sent. Please wait a few minutes, then try again."
    case "over_request_rate_limit":
      return "Too many attempts. Please wait a few minutes, then try again."
    case "invalid_credentials":
      return "Incorrect email or password."
    case "email_address_invalid":
      return "Enter a valid email address."
    case "signup_disabled":
      return "New sign-ups are currently turned off."
    case "user_already_exists":
    case "email_exists":
      return EXISTS_MESSAGE
  }
  // No usable answer: the network, or Supabase's auth service not responding (a gateway
  // error page has no CORS headers, so the browser reports it as a failed request).
  if (error.name === "AuthRetryableFetchError" || error.status === 0) {
    return "Couldn't reach the sign-in service. Check your connection, or try again in a minute."
  }
  // An answer that wasn't Supabase's JSON error: never show the raw parser message.
  if (error.name === "AuthUnknownError") {
    return "The sign-in service didn't respond properly. Please try again in a minute."
  }
  return message || GENERIC_MESSAGE
}

export type SignupOutcome =
  // A verification code was sent: a new account, or an existing account still unverified.
  | { kind: "verify" }
  // The email already belongs to a verified account. Supabase sends nothing in that case.
  | { kind: "exists" }
  // Email confirmation is turned off in the project: the user is signed in already.
  | { kind: "signed_in" }
  | { kind: "error"; message: string }

type SignupData = { user: { identities?: unknown[] | null } | null; session: unknown } | null | undefined

export function signupOutcome(data: SignupData, error: AuthErrorLike): SignupOutcome {
  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") return { kind: "exists" }
    return { kind: "error", message: authErrorMessage(error) }
  }
  if (data?.session) return { kind: "signed_in" }
  // With email confirmation on, Supabase answers a sign-up for an already verified email
  // with a placeholder user that has no identities (so accounts can't be probed) and sends
  // no email.
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return { kind: "exists" }
  if (data?.user) return { kind: "verify" }
  return { kind: "error", message: GENERIC_MESSAGE }
}

// ---- TEMPORARY SIH demo sign-up (SKILLBRIDGE_DEMO_AUTH=true; see lib/auth/demo-signup.ts) ----

export const DEMO_NOTICE = "SIH demo: accounts are created without email verification."

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
const DEMO_KEYS = ["email", "password", "name"]
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// POST /api/auth/demo-signup body. Nothing else is accepted: no metadata, roles or ids.
export function parseDemoSignup(body: unknown): Parsed<{ email: string; password: string; name: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "Request body must be a JSON object" }
  const record = body as Record<string, unknown>
  const extra = Object.keys(record).filter((key) => !DEMO_KEYS.includes(key))
  if (extra.length) return { ok: false, error: `unexpected field(s): ${extra.sort().join(", ")}` }

  const { email, password, name } = record
  if (typeof email !== "string" || email.trim().length > 254 || !EMAIL.test(email.trim())) return { ok: false, error: "Enter a valid email address." }
  if (typeof password !== "string" || password.length < 6 || password.length > 72) return { ok: false, error: "Use a password of 6 to 72 characters." }
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) return { ok: false, error: "Please enter your name (up to 100 characters)." }
  return { ok: true, value: { email: email.trim().toLowerCase(), password, name: name.trim() } }
}

export type DemoSignupOutcome =
  | { kind: "created" }
  | { kind: "exists" }
  // Demo mode is off on the server: use the normal email-code sign-up.
  | { kind: "disabled" }
  | { kind: "error"; message: string }

// Maps a POST /api/auth/demo-signup answer (status null: no response) for the login page.
export function demoSignupOutcome(status: number | null, body: unknown): DemoSignupOutcome {
  const data = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {}
  if (status === 201 && data.created === true) return { kind: "created" }
  if (status === 409 && data.code === "exists") return { kind: "exists" }
  if (status === 404) return { kind: "disabled" }
  if (status === null) return { kind: "error", message: "Couldn't reach SkillBridge. Check your connection, or try again in a minute." }
  if ((status === 400 || status === 429) && typeof data.error === "string" && data.error) return { kind: "error", message: data.error }
  return { kind: "error", message: GENERIC_MESSAGE }
}

// Where a user goes right after verifying: onboarding unless a profile already exists. A
// failed lookup is not proof that the profile is missing, so it goes to the dashboard,
// whose guard checks again.
export function afterVerification(profile: { lookupFailed: boolean; exists: boolean }) {
  return !profile.lookupFailed && !profile.exists ? "/setup-profile" : "/"
}

// The app shell's decision for the signed-in user's profile state (lib/profile-store.ts).
//   wait:  still checking; page content is not rendered yet.
//   login: no session.
//   setup: signed in without a profiles row, on a page that needs one.
//   allow: render the page. A failed profile lookup is not proof the profile is missing.
export type ProfileStatus = "idle" | "loading" | "ready" | "missing" | "signed-out" | "error"
export type GateDecision = "wait" | "login" | "setup" | "allow"

export function gateDecision(status: ProfileStatus, requireProfile: boolean): GateDecision {
  switch (status) {
    case "idle":
    case "loading":
      return "wait"
    case "signed-out":
      return "login"
    case "missing":
      return requireProfile ? "setup" : "allow"
    case "ready":
    case "error":
      return "allow"
  }
}
