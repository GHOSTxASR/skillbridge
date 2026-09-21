"use client"

import { supabase } from "@/lib/supabase-browser"
import { useEffect, useState } from "react"

const defaultProfile = {
  name: "",
  email: "",
  education: "",
  institution: "",
  skills: "",
  career: "",
}

export default function AccountPage() {
  const [editing, setEditing] = useState(false)
  const [profile, setProfile] = useState(defaultProfile)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

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

        setProfile({
          name: authName || data?.name || "",
          email: authEmail,
          education: data?.education ?? "",
          institution: data?.institution ?? "",
          skills: (() => {
            const existing = Array.isArray(data?.skills)
              ? data.skills
              : (typeof data?.skills === "string"
                ? data.skills.split(",").map((skill: string) => skill.trim()).filter(Boolean)
                : [])

            const additions = [
              "Statistics",
              "NumPy",
              "Pandas",
              "Data Visualization",
              "Machine Learning",
              "Scikit-learn",
            ]

            return Array.from(new Set([...existing, ...additions])).join(", ")
          })(),
          career: data?.target_role ?? "",
        })
      } catch (error) {
        console.error("Account loading error:", error)
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [])

  const update = (
    key: "education" | "institution" | "skills" | "career",
    value: string
  ) => {
    setProfile((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const saveProfile = async () => {
    setSaving(true)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        window.location.href = "/login"
        return
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          education: profile.education,
          institution: profile.institution,
          skills: profile.skills,
          target_role: profile.career,
        })
        .eq("id", user.id)

      if (error) {
  alert(String(error.message || error.code || "Profile save failed"))
  console.error("Profile save error:", error)
  return
}

      setEditing(false)
    } catch (error) {
      console.error("Save error:", JSON.stringify(error, null, 2))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Loading account information...
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Account Information
          </h1>

          <p className="text-sm text-muted-foreground">
            Manage your personal and career information.
          </p>
        </div>

        <button
          onClick={() => {
            if (editing) {
              saveProfile()
            } else {
              setEditing(true)
            }
          }}
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving
            ? "Saving..."
            : editing
              ? "Save Changes"
              : "Edit Profile"}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-3xl font-bold text-primary-foreground">
              {profile.name.charAt(0).toUpperCase() || "U"}
            </div>

            <h2 className="mt-4 text-xl font-semibold">
              {profile.name || "User"}
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              {profile.career || "Career goal not set"}
            </p>

            <div className="mt-5 w-full rounded-xl bg-muted/50 p-4 text-left">
              <p className="text-xs font-medium text-muted-foreground">
                PROFILE STATUS
              </p>

              <p className="mt-1 font-medium">Profile Active</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-semibold">Personal Information</h2>

          <p className="mt-1 text-sm text-muted-foreground">
            Your basic account details.
          </p>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Field
              label="Full Name"
              value={profile.name}
              editing={false}
              onChange={() => {}}
            />

            <Field
              label="Email"
              value={profile.email}
              editing={false}
              onChange={() => {}}
            />

            <Field
              label="Education"
              value={profile.education}
              editing={editing}
              onChange={(v) => update("education", v)}
            />

            <Field
              label="Institution"
              value={profile.institution}
              editing={editing}
              onChange={(v) => update("institution", v)}
            />

            <Field
              label="Skills"
              value={profile.skills}
              editing={editing}
              onChange={(v) => update("skills", v)}
            />

            <Field
              label="Career Interest"
              value={profile.career}
              editing={editing}
              onChange={(v) => update("career", v)}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">SkillBridge Profile</h2>

        <p className="mt-1 text-sm text-muted-foreground">
          Information used to personalize your SkillBridge experience.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">Assessment</p>

            <p className="mt-1 font-semibold">
              Not completed
            </p>
          </div>

          <div className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">Skills Added</p>

            <p className="mt-1 font-semibold">
              {typeof profile.skills === "string"
                ? profile.skills.split(",").map((skill) => skill.trim()).filter(Boolean).length
                : 0}{" "}              skills
            </p>
          </div>

          <div className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">
              Career Goal
            </p>

            <p className="mt-1 font-semibold">
              {profile.career || "Not set"}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  editing,
  onChange,
}: {
  label: string
  value: string
  editing: boolean
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label className="text-sm font-medium">
        {label}
      </label>

      {editing ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
        />
      ) : (
        <div className="mt-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          {value || "Not set"}
        </div>
      )}
    </div>
  )
}






