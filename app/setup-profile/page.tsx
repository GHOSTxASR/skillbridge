"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase-browser"
import { CAREER_ROLES, EXPERIENCE_LEVELS } from "@/lib/career-options"
import { cn } from "@/lib/utils"
import { AssistantTrigger } from "@/components/ai/ai-assistant"
import { Ambient } from "@/components/brand/ambient"
import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { ChoiceRow, ChoiceTile, StepProgress } from "@/components/ui/choice"
import { LEVEL_TEXT, roleIcon } from "@/components/career/role-icon"
import { FieldHint, Input } from "@/components/ui/field"
import { Notice } from "@/components/ui/states"

const STEPS = ["You", "Destination", "Starting point", "Review"]

export default function SetupProfilePage() {
  const [name, setName] = useState("")
  const [targetRole, setTargetRole] = useState("")
  const [experience, setExperience] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")

  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<"next" | "back">("next")

  useEffect(() => {
    const savedName = localStorage.getItem("skillbridge_signup_name")

    if (savedName) {
      setName(savedName)
      return
    }

    // Reached without this browser's signup (another device, a cleared browser, a
    // non-form sign-in): fall back to the name stored on the auth user.
    supabase.auth.getUser().then(({ data: { user } }) => {
      const metadataName = [
        user?.user_metadata?.name,
        user?.user_metadata?.full_name,
      ].find(
        (value): value is string =>
          typeof value === "string" && value.trim() !== ""
      )

      if (metadataName) {
        setName((current) => current || metadataName.trim())
      }
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!name.trim() || !targetRole || !experience) {
      setMessage("Please complete all fields.")
      return
    }

    setLoading(true)
    setMessage("")

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      window.location.href = "/login"
      return
    }

    // Create the row if it does not exist yet (ON CONFLICT DO NOTHING), then apply the
    // submitted fields. Both are scoped to the signed-in user's id, so a revisit or a
    // double submit never hits a duplicate key and never resets other profile data.
    const { error: createError } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          name: name.trim(),
          target_role: targetRole,
          experience_level: experience,
          job_readiness: 0,
          skills_mastered: 0,
          skill_gaps: 0,
          learning_progress: 0,
        },
        { onConflict: "id", ignoreDuplicates: true }
      )

    if (createError) {
      setMessage(createError.message)
      setLoading(false)
      return
    }

    const { data: savedProfile, error: saveError } = await supabase
      .from("profiles")
      .update({
        name: name.trim(),
        target_role: targetRole,
        experience_level: experience,
      })
      .eq("id", user.id)
      .select("id")

    if (saveError || !savedProfile?.length) {
      setMessage(
        saveError?.message ??
          "Your profile could not be saved. Please try again."
      )
      setLoading(false)
      return
    }

    localStorage.removeItem("skillbridge_signup_name")

    window.location.href = "/"
  }

  const canContinue =
    (step === 0 && name.trim() !== "") ||
    (step === 1 && targetRole !== "") ||
    (step === 2 && experience !== "") ||
    step === 3

  function go(to: number) {
    setDirection(to > step ? "next" : "back")
    setMessage("")
    setStep(to)
  }

  function onStepSubmit(e: React.FormEvent) {
    if (step === STEPS.length - 1) {
      void handleSubmit(e)
      return
    }

    e.preventDefault()
    if (canContinue) go(step + 1)
  }

  const firstName = name.trim().split(/\s+/)[0]

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <Ambient variant="hero" />

      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 pt-6 sm:px-8">
        <Logo />
        <div className="flex items-center gap-3">
          <p className="text-sm tabular-nums text-subtle-foreground">
            Step {step + 1} of {STEPS.length}
          </p>
          <AssistantTrigger compact />
        </div>
      </header>

      {/* Progress */}
      <div className="mx-auto mt-6 w-full max-w-5xl px-5 sm:px-8">
        <StepProgress steps={STEPS} current={step} />
      </div>

      <form
        onSubmit={onStepSubmit}
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-10 pt-12 sm:px-8 sm:pt-16"
      >
        <div
          key={step}
          className={cn("flex-1", direction === "next" ? "step-in-next" : "step-in-back")}
        >
          {step === 0 && (
            <div>
              <p className="type-eyebrow text-primary">Welcome to SkillBridge</p>
              <h1 className="type-display mt-4 text-foreground">What should we call you?</h1>
              <p className="mt-4 max-w-lg text-base text-muted-foreground">
                A few questions set up your career dashboard. It takes under a minute.
              </p>
              <div className="mt-10 max-w-md">
                <label htmlFor="name" className="sr-only">Your name</label>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoFocus
                  className="h-14 text-lg"
                />
                <FieldHint>Press Enter to continue.</FieldHint>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="type-eyebrow text-primary">
                {firstName ? `Nice to meet you, ${firstName}` : "Your destination"}
              </p>
              <h1 className="type-display mt-4 text-foreground">Where do you want to go?</h1>
              <p className="mt-4 max-w-lg text-base text-muted-foreground">
                Your target role is what SkillBridge measures your skills against. You can
                change it later.
              </p>
              <div
                role="radiogroup"
                aria-label="Target role"
                className="mt-10 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
              >
                {CAREER_ROLES.map((role, index) => (
                  <ChoiceTile
                    key={role}
                    label={role}
                    icon={roleIcon(role)}
                    selected={targetRole === role}
                    onSelect={() => setTargetRole(role)}
                    index={index}
                  />
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="type-eyebrow text-primary">Your starting point</p>
              <h1 className="type-display mt-4 text-foreground">Where are you starting from?</h1>
              <p className="mt-4 max-w-lg text-base text-muted-foreground">
                This sets the depth of your recommendations.
              </p>
              <div role="radiogroup" aria-label="Experience level" className="mt-10 max-w-xl space-y-2.5">
                {EXPERIENCE_LEVELS.map((level, index) => (
                  <ChoiceRow
                    key={level}
                    label={level}
                    description={LEVEL_TEXT[level]}
                    selected={experience === level}
                    onSelect={() => setExperience(level)}
                    index={index}
                  />
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <p className="type-eyebrow text-primary">Ready</p>
              <h1 className="type-display mt-4 text-foreground">Here&apos;s your starting point.</h1>
              <dl className="mt-10 max-w-xl divide-y divide-border border-y border-border">
                {[
                  { label: "Name", value: name.trim(), step: 0 },
                  { label: "Target role", value: targetRole, step: 1 },
                  { label: "Experience", value: experience, step: 2 },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <dt className="text-xs text-subtle-foreground">{row.label}</dt>
                      <dd className="mt-0.5 truncate text-base font-medium text-foreground">{row.value}</dd>
                    </div>
                    <button
                      type="button"
                      onClick={() => go(row.step)}
                      className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-primary transition-colors hover:bg-surface-2"
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </dl>
              <p className="mt-6 max-w-xl text-sm text-muted-foreground">
                Next, a short skill assessment records what you already know, so
                SkillBridge can map it against {targetRole || "your target role"}.
              </p>
            </div>
          )}
        </div>

        {message && (
          <Notice tone="danger" className="mt-8 max-w-xl">
            {message}
          </Notice>
        )}

        <div className="mt-12 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => go(step - 1)}
            disabled={step === 0 || loading}
            className={cn(step === 0 && "invisible")}
          >
            <ArrowLeft />
            Back
          </Button>

          <Button type="submit" size="lg" disabled={!canContinue || loading}>
            {loading && <Loader2 className="animate-spin" />}
            {step === STEPS.length - 1
              ? loading
                ? "Setting up your profile…"
                : "Create my profile"
              : "Continue"}
            {!loading && <ArrowRight />}
          </Button>
        </div>
      </form>
    </div>
  )
}
