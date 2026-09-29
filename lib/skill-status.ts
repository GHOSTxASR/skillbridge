// One vocabulary for skill levels across the UI.
//
// The skill-gap analysis labels skills "strength" / "weak" / "missing"; older data and
// components used "mastered" / "in-progress" / "gap". Both map onto the same three
// levels here. These are categories from the AI analysis, not measured scores, and
// the UI must present them as categories.

export type SkillLevel = "strong" | "developing" | "missing"

export const LEVELS: SkillLevel[] = ["missing", "developing", "strong"]

export const LEVEL_META: Record<
  SkillLevel,
  {
    label: string
    tone: "success" | "warning" | "danger"
    // Share of a comparison bar to fill; categorical, not a score.
    fill: number
    text: string
    dot: string
    bar: string
  }
> = {
  strong: {
    label: "Strong",
    tone: "success",
    fill: 1,
    text: "text-success",
    dot: "bg-success",
    bar: "bg-success",
  },
  developing: {
    label: "Developing",
    tone: "warning",
    fill: 0.5,
    text: "text-warning",
    dot: "bg-warning",
    bar: "bg-warning",
  },
  missing: {
    label: "Missing",
    tone: "danger",
    fill: 0,
    text: "text-destructive",
    dot: "bg-destructive",
    bar: "bg-destructive",
  },
}

export function levelFromStatus(status: unknown): SkillLevel | null {
  switch (status) {
    case "strength":
    case "mastered":
      return "strong"
    case "weak":
    case "in-progress":
      return "developing"
    case "missing":
    case "gap":
    case "critical":
      return "missing"
    default:
      return null
  }
}

export type AnalysisSkills = {
  skillGaps?: Array<{
    skill?: string
    status?: string
    priority?: string
    reason?: string
  }>
  strengths?: string[]
  weakSkills?: string[]
  missingSkills?: string[]
  gaps?: string[]
}

export type RequiredSkill = {
  skill: string
  level: SkillLevel
  priority?: "high" | "medium" | "low"
  reason?: string
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : []
}

// Every skill the analysis mentions, with its level. The per-skill entries win (they
// carry a reason and priority); the flat lists fill in anything they do not cover.
export function requiredSkills(analysis: AnalysisSkills | null | undefined): RequiredSkill[] {
  if (!analysis) return []

  const result: RequiredSkill[] = []
  const seen = new Set<string>()

  const add = (entry: RequiredSkill) => {
    const key = entry.skill.trim().toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    result.push({ ...entry, skill: entry.skill.trim() })
  }

  for (const gap of Array.isArray(analysis.skillGaps) ? analysis.skillGaps : []) {
    const level = levelFromStatus(gap?.status)
    if (!level || typeof gap?.skill !== "string") continue

    add({
      skill: gap.skill,
      level,
      priority:
        gap.priority === "high" || gap.priority === "medium" || gap.priority === "low"
          ? gap.priority
          : undefined,
      reason: typeof gap.reason === "string" && gap.reason.trim() ? gap.reason.trim() : undefined,
    })
  }

  for (const skill of strings(analysis.missingSkills ?? analysis.gaps)) add({ skill, level: "missing" })
  for (const skill of strings(analysis.weakSkills)) add({ skill, level: "developing" })
  for (const skill of strings(analysis.strengths)) add({ skill, level: "strong" })

  return result
}

export function countByLevel(skills: RequiredSkill[]): Record<SkillLevel, number> {
  return skills.reduce(
    (counts, entry) => {
      counts[entry.level] += 1
      return counts
    },
    { strong: 0, developing: 0, missing: 0 } as Record<SkillLevel, number>
  )
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const

// Missing before developing before strong; high priority first within a level.
export function sortByUrgency(skills: RequiredSkill[]): RequiredSkill[] {
  const levelOrder: Record<SkillLevel, number> = { missing: 0, developing: 1, strong: 2 }

  return [...skills].sort(
    (a, b) =>
      levelOrder[a.level] - levelOrder[b.level] ||
      (a.priority ? PRIORITY_ORDER[a.priority] : 3) - (b.priority ? PRIORITY_ORDER[b.priority] : 3)
  )
}
