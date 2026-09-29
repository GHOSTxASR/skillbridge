"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase-browser"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, Loader2, Sparkles } from "lucide-react"
import { allSkills } from "@/lib/mock-data"
import {
  CAREER_ROLES,
  EXPERIENCE_LEVELS,
  optionsWith,
  savedOption,
} from "@/lib/career-options"
import { refreshShellProfile } from "@/lib/profile-store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ChoiceRow, ChoiceTile, StepProgress } from "@/components/ui/choice"
import { Eyebrow } from "@/components/ui/page"
import { Notice } from "@/components/ui/states"
import { SkillBadge } from "@/components/skill-badge"
import { StatusBadge } from "@/components/status-badge"
import { LEVEL_TEXT, roleIcon } from "@/components/career/role-icon"

const steps = ["Target role", "Your skills", "Experience", "Review"]

// Presentation groups for the skill picker. Anything not listed here (for example a
// skill saved from the account page) appears under "From your profile".
const SKILL_GROUPS: Array<{ label: string; skills: string[] }> = [
  { label: "Languages", skills: ["Python", "JavaScript", "TypeScript", "Java", "C++"] },
  { label: "Web & APIs", skills: ["React", "Node.js", "REST APIs"] },
  { label: "Data", skills: ["SQL", "PostgreSQL", "MongoDB"] },
  { label: "Foundations & tools", skills: ["DSA", "Git", "Linux"] },
  { label: "Cloud & DevOps", skills: ["Docker", "AWS"] },
]

// profiles.skills is an array (saved by this page) or a comma-separated string (saved by
// the account page). Known skills take the picker's spelling.
function profileSkills(value: unknown): string[] {
  const items =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value
        : []

  const result: string[] = []

  for (const item of items) {
    const skill = savedOption(allSkills, item)

    if (
      skill &&
      !result.some((s) => s.toLowerCase() === skill.toLowerCase())
    ) {
      result.push(skill)
    }
  }

  return result
}

export default function AssessmentPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState<"next" | "back">("next")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  // The assessment starts from the saved profile, which holds the user's career target,
  // and saves back into it: the role only changes if the user picks a different one.
  const [savedRole, setSavedRole] = useState<string | null>(null)
  const [savedLevel, setSavedLevel] = useState<string | null>(null)
  const [savedSkills, setSavedSkills] = useState<string[]>([])

  const [role, setRole] = useState<string | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [experience, setExperience] = useState<string | null>(null)

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data: profile } = await supabase
        .from("profiles")
        .select("target_role, skills, experience_level")
        .eq("id", user.id)
        .maybeSingle()

      const currentRole = savedOption(CAREER_ROLES, profile?.target_role)
      const currentLevel = savedOption(
        EXPERIENCE_LEVELS,
        profile?.experience_level
      )
      const currentSkills = profileSkills(profile?.skills)

      setSavedRole(currentRole)
      setSavedLevel(currentLevel)
      setSavedSkills(currentSkills)

      // Keep anything the user already picked while the profile was loading.
      setRole((picked) => picked ?? currentRole)
      setExperience((picked) => picked ?? currentLevel)
      setSelectedSkills((picked) =>
        picked.length > 0 ? picked : currentSkills
      )
    }

    loadProfile()
  }, [])

  const roleOptions = optionsWith(CAREER_ROLES, savedRole)
  const levelOptions = optionsWith(EXPERIENCE_LEVELS, savedLevel)
  const skillOptions = [
    ...allSkills,
    ...savedSkills.filter((skill) => !allSkills.includes(skill)),
  ]

  const grouped = [
    ...SKILL_GROUPS.map((group) => ({
      label: group.label,
      skills: group.skills.filter((skill) => skillOptions.includes(skill)),
    })),
    {
      label: "From your profile",
      skills: skillOptions.filter(
        (skill) => !SKILL_GROUPS.some((group) => group.skills.includes(skill))
      ),
    },
  ].filter((group) => group.skills.length > 0)

  const saveAssessment = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.push("/login")
      return
    }

    setSaving(true)
    setSaveError("")

    const experienceScore: Record<string, number> = {
      Beginner: 10,
      Intermediate: 20,
      Advanced: 30,
      Professional: 30,
    }

    const skillScore = Math.min(selectedSkills.length * 5, 50)
    const readiness = Math.min(
      100,
      Math.max(0, 20 + skillScore + (experience ? experienceScore[experience] ?? 0 : 0))
    )

    const { data: updatedRows, error: profileError } = await supabase
      .from("profiles")
      .update({
        target_role: role,
        skills: selectedSkills,
        experience_level: experience,
      })
      .eq("id", user.id)
      .select("id")

    if (profileError) {
      console.error("PROFILE UPDATE ERROR:", JSON.stringify(profileError, null, 2))
      console.error("PROFILE UPDATE ERROR MESSAGE:", profileError?.message)
      console.error("PROFILE UPDATE ERROR CODE:", profileError?.code)
      console.error("PROFILE UPDATE ERROR DETAILS:", profileError?.details)
      console.error("PROFILE UPDATE ERROR HINT:", profileError?.hint)
      setSaveError(`Your assessment couldn't be saved: ${profileError?.message || "unknown error"}.`)
      setSaving(false)
      return
    }

    // No matching row (profile missing) means nothing was saved.
    if (!updatedRows?.length) {
      setSaveError("Your assessment couldn't be saved: no profile was found for this account.")
      setSaving(false)
      return
    }

    localStorage.setItem(
      `skillbridge-assessment-result-${user.id}`,
      JSON.stringify({
        readiness,
        role,
        skills: selectedSkills,
        experience,
        updatedAt: new Date().toISOString(),
      })
    )

    void refreshShellProfile()
    router.push("/gap-analysis")
  }

  const toggleSkill = (skill: string) =>
    setSelectedSkills((prev) =>
      prev.includes(skill)
        ? prev.filter((s) => s !== skill)
        : [...prev, skill],
    )

  const canContinue =
    (step === 1 && role) ||
    (step === 2 && selectedSkills.length > 0) ||
    (step === 3 && experience) ||
    step === 4

  function go(to: number) {
    setDirection(to > step ? "next" : "back")
    setSaveError("")
    setStep(Math.min(4, Math.max(1, to)))
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    if (step === 4) {
      void saveAssessment()
      return
    }
    if (canContinue) go(step + 1)
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex min-h-[calc(100dvh-12rem)] max-w-3xl flex-col">
      <div className="flex items-center justify-between gap-4">
        <Eyebrow tone="primary">Step 1 · Assess</Eyebrow>
        <span className="text-xs tabular-nums text-subtle-foreground">
          {step} of {steps.length}
        </span>
      </div>
      <StepProgress steps={steps} current={step - 1} className="mt-4" />

      <div
        key={step}
        className={cn("mt-12 flex-1", direction === "next" ? "step-in-next" : "step-in-back")}
      >
        {step === 1 && (
          <div>
            <h1 className="type-display text-foreground">What role are you targeting?</h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground">
              Your skills are benchmarked against this role. Your current target is
              preselected; choosing another role changes it.
            </p>
            <div role="radiogroup" aria-label="Target role" className="mt-10 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {roleOptions.map((r, index) => (
                <ChoiceTile
                  key={r}
                  label={r}
                  sublabel={r === savedRole ? "Current target" : undefined}
                  icon={roleIcon(r)}
                  selected={role === r}
                  onSelect={() => setRole(r)}
                  index={index}
                />
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h1 className="type-display text-foreground">What can you already do?</h1>
              <StatusBadge tone={selectedSkills.length > 0 ? "primary" : "neutral"}>
                {selectedSkills.length} selected
              </StatusBadge>
            </div>
            <p className="mt-4 max-w-xl text-base text-muted-foreground">
              Select every skill you have used in practice. You can refine these later.
            </p>
            <div className="mt-10 space-y-8">
              {grouped.map((group, groupIndex) => (
                <fieldset key={group.label} className="reveal" style={{ "--i": groupIndex } as React.CSSProperties}>
                  <legend className="type-eyebrow mb-3 text-subtle-foreground">{group.label}</legend>
                  <div className="flex flex-wrap gap-2">
                    {group.skills.map((skill) => (
                      <SkillBadge
                        key={skill}
                        name={skill}
                        selectable
                        selected={selectedSkills.includes(skill)}
                        onClick={() => toggleSkill(skill)}
                      />
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h1 className="type-display text-foreground">What&apos;s your experience level?</h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground">
              This sets the depth of your recommended roadmap.
            </p>
            <div role="radiogroup" aria-label="Experience level" className="mt-10 space-y-2.5">
              {levelOptions.map((level, index) => (
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

        {step === 4 && (
          <div>
            <h1 className="type-display text-foreground">Review your assessment</h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground">
              Confirm the details, then run the AI skill gap analysis.
            </p>

            <dl className="mt-10 divide-y divide-border border-y border-border">
              {[
                { label: "Target role", value: role, to: 1 },
                { label: "Experience", value: experience, to: 3 },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <dt className="text-xs text-subtle-foreground">{row.label}</dt>
                    <dd className="mt-0.5 truncate text-base font-medium text-foreground">{row.value}</dd>
                  </div>
                  <button type="button" onClick={() => go(row.to)} className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-primary transition-colors hover:bg-surface-2">
                    Edit
                  </button>
                </div>
              ))}
              <div className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-xs text-subtle-foreground">Skills ({selectedSkills.length})</dt>
                  <button type="button" onClick={() => go(2)} className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-primary transition-colors hover:bg-surface-2">
                    Edit
                  </button>
                </div>
                <dd className="mt-3 flex flex-wrap gap-2">
                  {selectedSkills.map((s) => (
                    <SkillBadge key={s} name={s} />
                  ))}
                </dd>
              </div>
            </dl>

            <div className="mt-8 flex items-start gap-3 rounded-xl border border-ai/20 bg-ai-muted px-4 py-3.5">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-ai" />
              <p className="text-sm leading-relaxed text-muted-foreground">
                Next, AI compares these skills with what {role ?? "your target role"} needs
                and shows your strengths, gaps and priorities.
              </p>
            </div>
          </div>
        )}
      </div>

      {saveError && (
        <Notice tone="danger" className="mt-8">
          {saveError}
        </Notice>
      )}

      <div className="mt-12 flex items-center justify-between gap-3 border-t border-border pt-6">
        <Button
          type="button"
          variant="ghost"
          onClick={() => go(step - 1)}
          disabled={step === 1 || saving}
          className={cn(step === 1 && "invisible")}
        >
          <ArrowLeft />
          Back
        </Button>

        <Button type="submit" size="lg" disabled={!canContinue || saving}>
          {saving && <Loader2 className="animate-spin" />}
          {step < 4 ? "Continue" : saving ? "Saving…" : "Analyze my skill gap"}
          {!saving && <ArrowRight />}
        </Button>
      </div>
    </form>
  )
}
