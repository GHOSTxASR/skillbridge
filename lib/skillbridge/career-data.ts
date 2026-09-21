export type Skill = {
  name: string
  score: number
  level: "Beginner" | "Intermediate" | "Advanced"
}

export type AssessmentResult = {
  score: number
  completedAt: string
  skills: Skill[]
}

export type SkillGap = {
  skill: string
  currentScore: number
  targetScore: number
  priority: "High" | "Medium" | "Low"
}

export type RoadmapItem = {
  id: string
  title: string
  skill: string
  level: string
  completed: boolean
}

export type JobMatch = {
  id: string
  title: string
  company: string
  location: string
  match: number
  skills: string[]
}

const ASSESSMENT_KEY = "skillbridge_assessment"
const ROADMAP_KEY = "skillbridge_roadmap"

export function saveAssessment(result: AssessmentResult) {
  localStorage.setItem(ASSESSMENT_KEY, JSON.stringify(result))
}

export function getAssessment(): AssessmentResult | null {
  const value = localStorage.getItem(ASSESSMENT_KEY)

  if (!value) return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function getSkillGaps(): SkillGap[] {
  const assessment = getAssessment()

  if (!assessment) return []

  return assessment.skills
    .filter((skill) => skill.score < 70)
    .map((skill) => ({
      skill: skill.name,
      currentScore: skill.score,
      targetScore: 80,
      priority:
        skill.score < 40
          ? "High"
          : skill.score < 60
            ? "Medium"
            : "Low",
    }))
}

export function getRoadmap(): RoadmapItem[] {
  const saved = localStorage.getItem(ROADMAP_KEY)

  if (saved) {
    try {
      return JSON.parse(saved)
    } catch {
      return []
    }
  }

  return getSkillGaps().map((gap, index) => ({
    id: `${gap.skill}-${index}`,
    title: `Improve ${gap.skill}`,
    skill: gap.skill,
    level:
      gap.currentScore < 40
        ? "Beginner"
        : gap.currentScore < 60
          ? "Intermediate"
          : "Advanced",
    completed: false,
  }))
}

export function saveRoadmap(items: RoadmapItem[]) {
  localStorage.setItem(ROADMAP_KEY, JSON.stringify(items))
}

export function calculateJobReadiness() {
  const assessment = getAssessment()

  if (!assessment || assessment.skills.length === 0) {
    return 0
  }

  const total = assessment.skills.reduce(
    (sum, skill) => sum + skill.score,
    0
  )

  return Math.round(total / assessment.skills.length)
}
