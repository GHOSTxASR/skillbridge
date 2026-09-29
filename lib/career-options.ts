// Career targets and experience levels users can pick. profiles.target_role and
// profiles.experience_level store these labels, and onboarding and the skill assessment
// both offer this same list. Saved values outside the list (older labels, text typed on
// the account page) stay valid: pickers keep showing them instead of replacing them.
export const CAREER_ROLES = [
  "Backend Engineer",
  "Frontend Developer",
  "Full Stack Developer",
  "Data Analyst",
  "Data Scientist",
  "DevOps Engineer",
  "Cloud Engineer",
  "Cybersecurity Analyst",
  "Software Engineer",
] as const

export const EXPERIENCE_LEVELS = [
  "Beginner",
  "Intermediate",
  "Advanced",
  "Professional",
] as const

function sameLabel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

// The option to preselect for a saved value: the list entry it matches (ignoring case and
// surrounding spaces), otherwise the saved value itself.
export function savedOption(
  options: readonly string[],
  saved: unknown
): string | null {
  if (typeof saved !== "string" || !saved.trim()) return null

  return options.find((option) => sameLabel(option, saved)) ?? saved.trim()
}

// The options to show: the list, plus the current value when it is not one of them.
export function optionsWith(
  options: readonly string[],
  current: string | null
): string[] {
  return current && !options.includes(current)
    ? [...options, current]
    : [...options]
}
