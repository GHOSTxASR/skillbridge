"use client"

import Link from "next/link"
import { supabase } from "@/lib/supabase-browser"
import { useEffect, useState } from "react"
import { ArrowRight, Check, GraduationCap, Loader2, Pencil, Target, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { refreshShellProfile } from "@/lib/profile-store"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input, Label, Textarea, FieldHint } from "@/components/ui/field"
import { Eyebrow } from "@/components/ui/page"
import { Notice, Skeleton } from "@/components/ui/states"
import { SkillBadge } from "@/components/skill-badge"

const defaultProfile = {
  name: "",
  email: "",
  education: "",
  institution: "",
  skills: "",
  career: "",
  experience: "",
}

type Profile = typeof defaultProfile

function skillList(value: string) {
  return value
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean)
}

function FieldRow({
  label,
  id,
  value,
  editing,
  onChange,
  placeholder,
  readOnlyNote,
}: {
  label: string
  id: string
  value: string
  editing: boolean
  onChange?: (value: string) => void
  placeholder?: string
  readOnlyNote?: React.ReactNode
}) {
  const editable = editing && onChange

  return (
    <div className="grid grid-cols-1 gap-2 py-5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center sm:gap-6">
      {editable ? (
        <Label htmlFor={id} className="mb-0">
          {label}
        </Label>
      ) : (
        <p className="text-[0.8125rem] font-medium text-muted-foreground">{label}</p>
      )}
      <div className="min-w-0">
        {editable ? (
          <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-11" />
        ) : (
          <p className={cn("text-[0.9375rem]", value ? "text-foreground" : "text-subtle-foreground")}>
            {value || "Not set"}
          </p>
        )}
        {readOnlyNote && <FieldHint className="mt-1.5">{readOnlyNote}</FieldHint>}
      </div>
    </div>
  )
}

export default function AccountPage() {
  const [editing, setEditing] = useState(false)
  const [profile, setProfile] = useState<Profile>(defaultProfile)
  const [saved, setSaved] = useState<Profile>(defaultProfile)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    async function loadProfile() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          window.location.href = "/login"
          return
        }

        const authName =
          user.user_metadata?.name?.trim() ||
          user.user_metadata?.full_name?.trim() ||
          ""

        const authEmail = user.email ?? ""

        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single()

        if (error) {
          console.error("Profile fetch error:", error)
        }

        // Only what is actually saved on the profile (no default or suggested skills).
        const existing = Array.isArray(data?.skills)
          ? data.skills
          : typeof data?.skills === "string"
            ? data.skills.split(",").map((skill: string) => skill.trim()).filter(Boolean)
            : []

        const loaded: Profile = {
          name: authName || data?.name || "",
          email: authEmail,
          education: data?.education ?? "",
          institution: data?.institution ?? "",
          skills: Array.from(new Set(existing.map(String))).join(", "),
          career: data?.target_role ?? "",
          experience: data?.experience_level ?? "",
        }

        setProfile(loaded)
        setSaved(loaded)
      } catch (error) {
        console.error("Account loading error:", error)
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [])

  const update = (key: "education" | "institution" | "skills" | "career", value: string) => {
    setProfile((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const saveProfile = async () => {
    setSaving(true)
    setSaveError("")

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        window.location.href = "/login"
        return
      }

      const { data: savedRows, error } = await supabase
        .from("profiles")
        .update({
          education: profile.education,
          institution: profile.institution,
          skills: profile.skills,
          target_role: profile.career,
        })
        .eq("id", user.id)
        .select("id")

      // No matching row (profile missing) is a failed save, not a success.
      if (error || !savedRows?.length) {
        setSaveError(String(error?.message || error?.code || "Your profile could not be saved."))
        console.error("Profile save error:", error ?? "no profile row was updated")
        return
      }

      setSaved(profile)
      setEditing(false)
      setJustSaved(true)
      void refreshShellProfile()
    } catch (error) {
      console.error("Save error:", JSON.stringify(error, null, 2))
      setSaveError("Your profile could not be saved. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!justSaved) return
    const timer = window.setTimeout(() => setJustSaved(false), 3500)
    return () => window.clearTimeout(timer)
  }, [justSaved])

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading your profile" className="grid grid-cols-1 gap-12 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Skeleton className="size-24 rounded-full" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-52" />
        </div>
        <div className="space-y-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    )
  }

  const skills = skillList(profile.skills)
  const initial = (profile.name || profile.email || "U").charAt(0).toUpperCase()

  return (
    <div className="grid grid-cols-1 gap-12 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-16">
      {/* Identity */}
      <aside className="lg:sticky lg:top-14 lg:self-start">
        <Eyebrow tone="primary">Profile · You</Eyebrow>
        <span
          className="mt-6 flex size-24 items-center justify-center rounded-full p-[2px]"
          style={{ background: "var(--brand-gradient)" }}
          aria-hidden="true"
        >
          <span className="flex size-full items-center justify-center rounded-full bg-background text-3xl font-semibold text-foreground">
            {initial}
          </span>
        </span>
        <h1 className="type-title mt-5 text-foreground">{profile.name || "Your profile"}</h1>
        {profile.email && <p className="mt-1.5 break-all text-sm text-muted-foreground">{profile.email}</p>}

        <dl className="mt-8 space-y-4 border-t border-border pt-6">
          <div className="flex items-start gap-3">
            <Target className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <dt className="text-xs text-subtle-foreground">Career goal</dt>
              <dd className="mt-0.5 text-sm font-medium text-foreground">{saved.career || "Not set"}</dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <UserRound className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <dt className="text-xs text-subtle-foreground">Experience</dt>
              <dd className="mt-0.5 text-sm font-medium text-foreground">{saved.experience || "Not set"}</dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <GraduationCap className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <dt className="text-xs text-subtle-foreground">Skills recorded</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{skillList(saved.skills).length}</dd>
            </div>
          </div>
        </dl>

        <Link href="/assessment" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mt-6 -ml-3")}>
          Retake skill assessment
          <ArrowRight />
        </Link>
      </aside>

      {/* Details */}
      <div className="min-w-0">
        <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="type-heading text-foreground">Profile details</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The foundation SkillBridge uses to analyze your skills and match jobs.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {editing ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setProfile(saved)
                    setEditing(false)
                    setSaveError("")
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button onClick={saveProfile} disabled={saving}>
                  {saving ? <Loader2 className="animate-spin" /> : <Check />}
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil />
                Edit profile
              </Button>
            )}
          </div>
        </div>

        {saveError && (
          <Notice tone="danger" className="mt-6">
            {saveError}
          </Notice>
        )}
        {justSaved && (
          <Notice tone="success" className="mt-6">
            Your profile was saved.
          </Notice>
        )}

        <section className="mt-10" aria-labelledby="career-title">
          <h3 id="career-title" className="type-eyebrow text-subtle-foreground">Career</h3>
          <div className="divide-y divide-border">
            <FieldRow
              id="career"
              label="Career goal"
              value={profile.career}
              editing={editing}
              onChange={(v) => update("career", v)}
              placeholder="For example, Full Stack Developer"
            />
            <FieldRow
              id="experience"
              label="Experience"
              value={profile.experience}
              editing={editing}
              readOnlyNote={
                editing ? (
                  <>
                    Change your experience level in the{" "}
                    <Link href="/assessment" className="text-primary underline-offset-4 hover:underline">
                      skill assessment
                    </Link>
                    .
                  </>
                ) : undefined
              }
            />
          </div>
        </section>

        <section className="mt-12" aria-labelledby="skills-title">
          <h3 id="skills-title" className="type-eyebrow text-subtle-foreground">Skills</h3>
          <div className="py-5">
            {editing ? (
              <>
                <Label htmlFor="skills">Your skills</Label>
                <Textarea
                  id="skills"
                  value={profile.skills}
                  onChange={(e) => update("skills", e.target.value)}
                  placeholder="Python, SQL, Git"
                />
                <FieldHint>Separate skills with commas.</FieldHint>
                {skills.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2" aria-label="Preview">
                    {skills.map((skill) => (
                      <SkillBadge key={skill} name={skill} />
                    ))}
                  </div>
                )}
              </>
            ) : skills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <SkillBadge key={skill} name={skill} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-subtle-foreground">
                No skills recorded yet.{" "}
                <Link href="/assessment" className="text-primary underline-offset-4 hover:underline">
                  Add them in the skill assessment
                </Link>
                .
              </p>
            )}
          </div>
        </section>

        <section className="mt-12" aria-labelledby="education-title">
          <h3 id="education-title" className="type-eyebrow text-subtle-foreground">Education</h3>
          <div className="divide-y divide-border">
            <FieldRow
              id="education"
              label="Education"
              value={profile.education}
              editing={editing}
              onChange={(v) => update("education", v)}
              placeholder="For example, B.Tech Computer Science"
            />
            <FieldRow
              id="institution"
              label="Institution"
              value={profile.institution}
              editing={editing}
              onChange={(v) => update("institution", v)}
              placeholder="Your college or university"
            />
          </div>
        </section>

        <section className="mt-12" aria-labelledby="account-title">
          <h3 id="account-title" className="type-eyebrow text-subtle-foreground">Account</h3>
          <div className="divide-y divide-border">
            <FieldRow id="name" label="Full name" value={profile.name} editing={false} />
            <FieldRow id="email" label="Email" value={profile.email} editing={false} />
          </div>
        </section>
      </div>
    </div>
  )
}
