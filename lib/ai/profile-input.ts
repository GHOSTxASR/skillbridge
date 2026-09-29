import type { createSupabaseServerClient } from "@/lib/supabase-server"

// Career inputs for AI prompts come from the signed-in user's saved profile, never from
// the request body: profiles.target_role is the canonical career target, and the
// assessment is the flow that changes it.

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

const MAX_SKILLS = 30
const MAX_SKILL_LENGTH = 80
const MAX_ROLE_LENGTH = 150
const MAX_EXPERIENCE_LENGTH = 100

// Default career target when a profile has none, as in the other routes.
const DEFAULT_ROLE = "Software Engineer"

export type CareerProfile = {
  targetRole: string
  experience: string
  skills: string[]
}

export type CareerProfileResult =
  | { status: "ok"; profile: CareerProfile }
  | { status: "missing" }
  | { status: "error" }

// Same character rules as the learning route's skill cleaning.
function clean(value: unknown): string {
  if (typeof value !== "string") return ""

  return value.replace(/[^\w\s.+#/&-]/g, "").trim()
}

// One line, trimmed and bounded, so a saved value cannot reshape a prompt.
function oneLine(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return ""

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength)
}

// profiles.skills is an array (assessment) or a comma-separated string (account page).
// Cleaned, empty and over-long names dropped, case-insensitively de-duplicated keeping
// the first spelling, and capped.
export function normalizeSkills(value: unknown): string[] {
  const items =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value
        : []

  const seen = new Set<string>()
  const skills: string[] = []

  for (const item of items) {
    if (skills.length === MAX_SKILLS) break

    const skill = clean(item)
    if (!skill || skill.length > MAX_SKILL_LENGTH) continue

    const key = skill.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    skills.push(skill)
  }

  return skills
}

// RLS limits the read to the user's own row. "missing" means onboarding is not done;
// "error" means the profile could not be read, which is not proof that it is missing.
export async function loadCareerProfile(
  supabase: ServerClient,
  userId: string
): Promise<CareerProfileResult> {
  const { data, error } = await supabase
    .from("profiles")
    .select("target_role, skills, experience_level")
    .eq("id", userId)
    .maybeSingle()

  if (error) {
    console.error("Profile read failed:", error.code ?? "unknown")
    return { status: "error" }
  }

  if (!data) return { status: "missing" }

  return {
    status: "ok",
    profile: {
      targetRole:
        oneLine(data.target_role, MAX_ROLE_LENGTH) || DEFAULT_ROLE,
      experience: oneLine(data.experience_level, MAX_EXPERIENCE_LENGTH),
      skills: normalizeSkills(data.skills),
    },
  }
}
