"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { supabase } from "@/lib/supabase-browser"

type Profile = {
  name?: string | null
  target_role?: string | null
}

type Props = {
  profile: Profile
  preferences: {
    experienceLevel: string
    careerGoal: string
    jobType: string
    preferredLocation: string
    weeklyHours: string
    learningStyle: string
  }
  onClose: () => void
  onSaved: (profile: Profile, preferences: Props["preferences"]) => void
}

export function EditProfile({
  profile,
  preferences,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState(profile.name ?? "")
  const [targetRole, setTargetRole] = useState(profile.target_role ?? "")

  const [experienceLevel, setExperienceLevel] = useState(
    preferences.experienceLevel
  )
  const [careerGoal, setCareerGoal] = useState(preferences.careerGoal)
  const [jobType, setJobType] = useState(preferences.jobType)
  const [preferredLocation, setPreferredLocation] = useState(
    preferences.preferredLocation
  )
  const [weeklyHours, setWeeklyHours] = useState(preferences.weeklyHours)
  const [learningStyle, setLearningStyle] = useState(
    preferences.learningStyle
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function saveProfile() {
    setSaving(true)
    setError("")

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setError("User session not found.")
      setSaving(false)
      return
    }

    const updatedProfile = {
      name: name.trim(),
      target_role: targetRole.trim(),
    }

    const { error } = await supabase
      .from("profiles")
      .update(updatedProfile)
      .eq("id", user.id)

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }

    const updatedPreferences = {
      experienceLevel,
      careerGoal,
      jobType,
      preferredLocation,
      weeklyHours,
      learningStyle,
    }

    localStorage.setItem(
      `skillbridge_account_preferences_${user.id}`,
      JSON.stringify(updatedPreferences)
    )

    onSaved(updatedProfile, updatedPreferences)

    setSaving(false)
    onClose()
  }

  const inputClass =
    "w-full rounded-md border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-card p-6 shadow-xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">Edit Profile</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Update your personal, career and learning preferences.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-6">

          <section>
            <h3 className="mb-3 font-semibold">Personal Information</h3>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Full Name
                </label>

                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your full name"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-3 font-semibold">Career Information</h3>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Target Role
                </label>

                <input
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  placeholder="e.g. Software Developer"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Experience Level
                </label>

                <select
                  value={experienceLevel}
                  onChange={(e) => setExperienceLevel(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select experience level</option>
                  <option value="Student">Student</option>
                  <option value="Fresher">Fresher</option>
                  <option value="Entry Level">Entry Level</option>
                  <option value="Mid Level">Mid Level</option>
                  <option value="Experienced">Experienced</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Career Goal
                </label>

                <input
                  value={careerGoal}
                  onChange={(e) => setCareerGoal(e.target.value)}
                  placeholder="e.g. Get a software developer job"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Preferred Job Type
                </label>

                <select
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select job type</option>
                  <option value="Full-time">Full-time</option>
                  <option value="Part-time">Part-time</option>
                  <option value="Internship">Internship</option>
                  <option value="Remote">Remote</option>
                  <option value="Hybrid">Hybrid</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Preferred Location
                </label>

                <input
                  value={preferredLocation}
                  onChange={(e) => setPreferredLocation(e.target.value)}
                  placeholder="e.g. Kolkata, Bangalore, Remote"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-3 font-semibold">Learning Preferences</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Weekly Learning Hours
                </label>

                <select
                  value={weeklyHours}
                  onChange={(e) => setWeeklyHours(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select hours</option>
                  <option value="2-4 hours">2–4 hours</option>
                  <option value="5-7 hours">5–7 hours</option>
                  <option value="8-10 hours">8–10 hours</option>
                  <option value="10+ hours">10+ hours</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Learning Style
                </label>

                <select
                  value={learningStyle}
                  onChange={(e) => setLearningStyle(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select style</option>
                  <option value="Video">Video</option>
                  <option value="Hands-on">Hands-on</option>
                  <option value="Reading">Reading</option>
                  <option value="Projects">Projects</option>
                  <option value="Mixed">Mixed</option>
                </select>
              </div>
            </div>
          </section>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 border-t pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={saveProfile}
              disabled={saving}
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

