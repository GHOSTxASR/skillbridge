"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  ArrowRight,
  BriefcaseBusiness,
  ClipboardCheck,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Route,
  ScanSearch,
} from "lucide-react"
import { supabase } from "@/lib/supabase-browser"
import {
  CODE_MAX_LENGTH,
  EXISTS_MESSAGE,
  PENDING_VERIFICATION_KEY,
  RESEND_COOLDOWN_SECONDS,
  afterVerification,
  authErrorMessage,
  isCodeComplete,
  normalizeCode,
  signupOutcome,
} from "@/lib/auth/flow"
import { cn } from "@/lib/utils"
import { Ambient } from "@/components/brand/ambient"
import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { FieldHint, Input, Label } from "@/components/ui/field"
import { Notice } from "@/components/ui/states"

const JOURNEY = [
  { icon: ClipboardCheck, title: "Assess", text: "Record your target role, skills and experience." },
  { icon: ScanSearch, title: "Understand", text: "See your strengths and gaps for that role." },
  { icon: Route, title: "Learn", text: "Follow an ordered, AI-built learning roadmap." },
  { icon: BriefcaseBusiness, title: "Apply", text: "Browse live openings ranked against your profile." },
]

export default function LoginPage() {
  const [isSignup, setIsSignup] = useState(false)
  const [isVerify, setIsVerify] = useState(false)

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [otp, setOtp] = useState("")

  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  // Only confirmations ("code sent") are informational; every other message is an error.
  const [messageTone, setMessageTone] = useState<"error" | "info">("error")
  // Set when a sign-up hits an email that already has an account: offers sign-in or a code.
  const [existingEmail, setExistingEmail] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  // Synchronous guard: a second submit before the first answer is ignored.
  const busyRef = useRef(false)

  function showMessage(text: string, tone: "error" | "info" = "error") {
    setMessageTone(tone)
    setMessage(text)
  }

  // A signed-in visitor has nothing to do here. getUser() asks the server, like the app
  // shell's guard does, so a revoked session never bounces between /login and /. A tab
  // refreshed while waiting for a code returns to the code screen for the same email.
  useEffect(() => {
    let pending: string | null = null
    try {
      pending = sessionStorage.getItem(PENDING_VERIFICATION_KEY)
    } catch {
      // Storage unavailable: start from sign-in.
    }

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        window.location.replace("/")
        return
      }
      if (pending) {
        setEmail(pending)
        setIsVerify(true)
        showMessage("Enter the verification code from your email.", "info")
      }
    })
  }, [])

  // The resend cooldown counts down once a second, only while it is running.
  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  function startVerification(address: string, notice: string, cooldown: number) {
    try {
      sessionStorage.setItem(PENDING_VERIFICATION_KEY, address)
    } catch {
      // Storage unavailable: a refresh returns to sign-in, which leads back here.
    }
    setEmail(address)
    setIsVerify(true)
    setExistingEmail(null)
    setOtp("")
    setPassword("")
    setResendIn(cooldown)
    showMessage(notice, "info")
  }

  function leaveVerification() {
    try {
      sessionStorage.removeItem(PENDING_VERIFICATION_KEY)
    } catch {
      // Nothing stored.
    }
    setIsVerify(false)
    setIsSignup(false)
    setOtp("")
    setResendIn(0)
    showMessage("")
  }

  // Each handler returns true when it is navigating away (the form then stays locked).
  async function handleSignup(e: FormEvent): Promise<boolean> {
    e.preventDefault()

    if (!name.trim()) {
      showMessage("Please enter your name.")
      return false
    }

    const address = email.trim()
    setExistingEmail(null)
    showMessage("")

    const { data, error } = await supabase.auth.signUp({
      email: address,
      password,
      options: {
        data: {
          name: name.trim(),
        },
      },
    })

    const outcome = signupOutcome(data, error)

    if (outcome.kind === "error") {
      showMessage(outcome.message)
      return false
    }

    if (outcome.kind === "exists") {
      setExistingEmail(address)
      showMessage(EXISTS_MESSAGE)
      return false
    }

    localStorage.setItem("skillbridge_signup_name", name.trim())

    if (outcome.kind === "signed_in") {
      window.location.replace("/setup-profile")
      return true
    }

    startVerification(address, "We sent a verification code to your email.", RESEND_COOLDOWN_SECONDS)
    return false
  }

  async function verifyEmail(e: FormEvent): Promise<boolean> {
    e.preventDefault()

    if (!isCodeComplete(otp)) {
      showMessage("Enter the verification code from your email.")
      return false
    }

    showMessage("")

    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp,
      type: "email",
    })

    if (error || !data.session || !data.user) {
      showMessage(authErrorMessage(error))
      setOtp("")
      return false
    }

    try {
      sessionStorage.removeItem(PENDING_VERIFICATION_KEY)
    } catch {
      // Nothing stored.
    }

    // Verified and signed in. The profile is looked up for the session's own user (RLS
    // limits the read to that row): new accounts go to onboarding, others to the dashboard.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", data.user.id)
      .maybeSingle()

    window.location.replace(afterVerification({ lookupFailed: Boolean(profileError), exists: Boolean(profile) }))
    return true
  }

  async function handleLogin(e: FormEvent): Promise<boolean> {
    e.preventDefault()

    const address = email.trim()
    showMessage("")

    const { error } = await supabase.auth.signInWithPassword({
      email: address,
      password,
    })

    // An account created but never verified: finish verification with a code instead of
    // leaving the user stuck at sign-in.
    if (error?.code === "email_not_confirmed") {
      startVerification(
        address,
        "This email isn't verified yet. Enter the code from your verification email, or send a new code.",
        0
      )
      return false
    }

    if (error) {
      showMessage(authErrorMessage(error))
      return false
    }

    window.location.replace("/")
    return true
  }

  async function resendCode(address = email.trim()) {
    if (resending || resendIn > 0 || !address) return

    setResending(true)
    const { error } = await supabase.auth.resend({ type: "signup", email: address })
    setResending(false)

    if (error) {
      const wait = error.message?.match(/after (\d+) seconds?/i)
      if (wait) setResendIn(Number(wait[1]))
      showMessage(authErrorMessage(error))
      return
    }

    // Supabase gives the same answer whether or not the account still needs verifying.
    startVerification(
      address,
      "If this account still needs verifying, a new code is on its way. Use the code from the most recent email.",
      RESEND_COOLDOWN_SECONDS
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (busyRef.current) return
    busyRef.current = true
    setLoading(true)

    let leaving = false
    try {
      leaving = isVerify ? await verifyEmail(e) : isSignup ? await handleSignup(e) : await handleLogin(e)
    } finally {
      if (!leaving) {
        busyRef.current = false
        setLoading(false)
      }
    }
  }

  function switchMode(signup: boolean) {
    setIsSignup(signup)
    setExistingEmail(null)
    showMessage("")
  }

  const submitLabel = loading
    ? isVerify
      ? "Verifying…"
      : isSignup
        ? "Creating account…"
        : "Signing in…"
    : isVerify
      ? "Verify email"
      : isSignup
        ? "Create account"
        : "Sign in"

  return (
    <main className="relative isolate min-h-dvh overflow-hidden">
      <Ambient variant="hero" />

      <div className="mx-auto grid min-h-dvh w-full max-w-6xl grid-cols-1 items-center gap-12 px-5 py-10 lg:grid-cols-[1.1fr_1fr] lg:gap-20 lg:px-10">
        {/* Story */}
        <section className="reveal" style={{ "--i": 0 } as React.CSSProperties}>
          <Logo />

          <h1 className="type-display mt-10 max-w-xl text-foreground lg:mt-16">
            Know exactly what stands between you and your{" "}
            <span className="text-gradient">next role</span>.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground text-pretty">
            SkillBridge maps your skills against the role you want, builds the learning
            path to close the gap, and ranks live openings against your profile.
          </p>

          <ol className="mt-10 hidden max-w-md space-y-0 lg:block">
            {JOURNEY.map((step, index) => {
              const Icon = step.icon
              return (
                <li
                  key={step.title}
                  className="reveal relative flex gap-4 pb-6 last:pb-0"
                  style={{ "--i": index + 2 } as React.CSSProperties}
                >
                  {index < JOURNEY.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[17px] top-10 h-[calc(100%-2.5rem)] w-px bg-border-strong"
                    />
                  )}
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border-strong bg-[oklch(0.17_0.012_262/80%)] text-primary">
                    <Icon className="size-4" />
                  </span>
                  <div className="pt-1.5">
                    <p className="text-sm font-semibold text-foreground">{step.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{step.text}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        {/* Authentication */}
        <section
          className="reveal w-full max-w-md justify-self-center lg:justify-self-end"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          <div className="surface-glass rounded-3xl p-6 shadow-[0_40px_120px_-40px_rgb(0_0_0/80%)] sm:p-8">
            {isVerify ? (
              <div key="verify" className="step-in-next">
                <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-primary">
                  <Mail className="size-5" />
                </span>
                <h2 className="type-title mt-5 text-[1.75rem] text-foreground">Check your email</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Enter the verification code we emailed to
                </p>
                <p className="mt-0.5 break-all text-sm font-medium text-foreground">{email}</p>

                <form onSubmit={handleSubmit} className="mt-7 space-y-5" noValidate={false}>
                  <div>
                    <Label htmlFor="otp">Verification code</Label>
                    <Input
                      id="otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={CODE_MAX_LENGTH}
                      value={otp}
                      onChange={(e) => setOtp(normalizeCode(e.target.value))}
                      placeholder="••••••"
                      required
                      autoFocus
                      aria-describedby="otp-hint"
                      className="h-14 text-center font-mono text-2xl tracking-[0.4em]"
                    />
                    <FieldHint id="otp-hint">
                      The code is in the email from SkillBridge. Check spam if it hasn&apos;t arrived.
                    </FieldHint>
                  </div>

                  {message && (
                    <Notice tone={messageTone === "info" ? "info" : "danger"}>{message}</Notice>
                  )}

                  <Button
                    type="submit"
                    size="lg"
                    disabled={loading || !isCodeComplete(otp)}
                    className="w-full"
                  >
                    {loading && <Loader2 className="animate-spin" />}
                    {submitLabel}
                  </Button>
                </form>

                <div className="mt-5 flex flex-col items-center gap-1 text-sm">
                  <button
                    type="button"
                    onClick={() => void resendCode()}
                    disabled={resending || resendIn > 0 || loading}
                    className="rounded-lg px-3 py-2 font-medium text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-subtle-foreground disabled:hover:bg-transparent"
                  >
                    {resending
                      ? "Sending a new code…"
                      : resendIn > 0
                        ? `Send a new code in ${resendIn}s`
                        : "Send a new code"}
                  </button>
                  <button
                    type="button"
                    onClick={leaveVerification}
                    className="rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Back to sign in
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div
                  role="group"
                  aria-label="Choose sign in or create account"
                  className="grid grid-cols-2 gap-1 rounded-xl bg-[oklch(0.13_0.01_262/70%)] p-1 ring-1 ring-inset ring-border"
                >
                  {[
                    { label: "Sign in", signup: false },
                    { label: "Create account", signup: true },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={isSignup === option.signup}
                      onClick={() => switchMode(option.signup)}
                      className={cn(
                        "pressable h-9 rounded-lg text-sm font-medium",
                        isSignup === option.signup
                          ? "bg-surface-2 text-foreground shadow-[inset_0_1px_0_oklch(1_0_0/6%)] ring-1 ring-inset ring-border-strong"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div key={isSignup ? "signup" : "signin"} className={isSignup ? "step-in-next" : "step-in-back"}>
                  <h2 className="type-title mt-7 text-[1.75rem] text-foreground">
                    {isSignup ? "Create your account" : "Welcome back"}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {isSignup
                      ? "Start mapping your skills to the role you want."
                      : "Sign in to continue your career journey."}
                  </p>

                  <form onSubmit={handleSubmit} className="mt-7 space-y-5">
                    {isSignup && (
                      <div>
                        <Label htmlFor="name">Full name</Label>
                        <Input
                          id="name"
                          type="text"
                          autoComplete="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Your name"
                          required
                        />
                      </div>
                    )}

                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="password">Password</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete={isSignup ? "new-password" : "current-password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={isSignup ? "At least 6 characters" : "Your password"}
                          required
                          minLength={6}
                          className="pr-12"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          aria-pressed={showPassword}
                          className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                        >
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                      {isSignup && <FieldHint>Use at least 6 characters.</FieldHint>}
                    </div>

                    {message && (
                      <Notice tone={messageTone === "info" ? "info" : "danger"}>{message}</Notice>
                    )}

                    {existingEmail && isSignup && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          variant="secondary"
                          className="flex-1"
                          onClick={() => {
                            setEmail(existingEmail)
                            switchMode(false)
                          }}
                        >
                          Sign in instead
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className="flex-1"
                          disabled={resending || resendIn > 0}
                          onClick={() => void resendCode(existingEmail)}
                        >
                          {resending ? <Loader2 className="animate-spin" /> : null}
                          Resend verification
                        </Button>
                      </div>
                    )}

                    <Button type="submit" size="lg" disabled={loading} className="w-full">
                      {loading ? <Loader2 className="animate-spin" /> : null}
                      {submitLabel}
                      {!loading && <ArrowRight />}
                    </Button>
                  </form>
                </div>

                <p className="mt-6 text-center text-sm text-subtle-foreground">
                  {isSignup ? "Already have an account?" : "New to SkillBridge?"}{" "}
                  <button
                    type="button"
                    onClick={() => switchMode(!isSignup)}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {isSignup ? "Sign in" : "Create an account"}
                  </button>
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
