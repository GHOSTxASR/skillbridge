import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { groqJSON } from "@/lib/ai/groq"

type SkillAnalysis = {
  targetRole: string
  readiness: number
  summary: string

  strengths: string[]

  currentSkills: string[]
  requiredSkills: string[]

  missingSkills: string[]
  weakSkills: string[]

  prioritySkills: string[]

  skillGaps: Array<{
    skill: string
    status: "missing" | "weak" | "strength"
    priority: "high" | "medium" | "low"
    reason: string
  }>

  roadmap: Array<{
    order: number
    phase: string
    skill: string
    reason: string
    prerequisite: string
    estimatedHours: number
    topics: string[]
    practice: string[]
    project: string
    checkpoint: string
  }>

  jobFit: {
    score: number
    explanation: string
  }

  aiAvailable: boolean
}

function clean(value: unknown): string {
  if (typeof value !== "string") return ""

  return value
    .replace(/[^\w\s.+#/&-]/g, "")
    .trim()
}

function skills(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map(clean)
    .filter(Boolean)
    .filter((skill, index, array) => {
      return (
        array.findIndex(
          x => x.toLowerCase() === skill.toLowerCase()
        ) === index
      )
    })
}

function fallback(profile: any): SkillAnalysis {
  const targetRole =
    typeof profile?.target_role === "string" &&
    profile.target_role.trim()
      ? profile.target_role.trim()
      : "Software Engineer"

  const currentSkills = skills(profile?.skills)

  const role = targetRole.toLowerCase()

  let requiredSkills: string[]

  if (
    role.includes("frontend") ||
    role.includes("react") ||
    role.includes("web")
  ) {
    requiredSkills = [
      "HTML & CSS",
      "JavaScript",
      "TypeScript",
      "React",
      "Next.js",
      "Git",
      "REST APIs",
      "Testing",
    ]
  } else if (
    role.includes("backend") ||
    role.includes("node") ||
    role.includes("software")
  ) {
    requiredSkills = [
      "Programming Fundamentals",
      "Data Structures & Algorithms",
      "Git",
      "REST APIs",
      "Node.js",
      "SQL",
      "PostgreSQL",
      "Testing",
      "Docker",
      "System Design",
    ]
  } else if (
    role.includes("data") ||
    role.includes("analyst") ||
    role.includes("machine learning") ||
    role.includes("ml")
  ) {
    requiredSkills = [
      "Python",
      "Statistics",
      "SQL",
      "NumPy",
      "Pandas",
      "Data Visualization",
      "Machine Learning",
      "Scikit-learn",
      "Git",
    ]
  } else if (
    role.includes("devops") ||
    role.includes("cloud")
  ) {
    requiredSkills = [
      "Linux",
      "Git",
      "Networking",
      "Docker",
      "CI/CD",
      "AWS",
      "Kubernetes",
      "Terraform",
    ]
  } else {
    requiredSkills = [
      "Programming Fundamentals",
      "Data Structures & Algorithms",
      "Git",
      "SQL",
      "REST APIs",
      "Testing",
      "Docker",
      "System Design",
    ]
  }

  const current = new Set(
    currentSkills.map(x => x.toLowerCase())
  )

  const missingSkills = requiredSkills.filter(
    x => !current.has(x.toLowerCase())
  )

  const strengthSkills = requiredSkills.filter(
    x => current.has(x.toLowerCase())
  )

  const weakSkills = strengthSkills.slice(0, 2)

  const prioritySkills = [
    ...missingSkills,
    ...weakSkills,
  ].slice(0, 8)

  const roadmap = prioritySkills.map((skill, index) => ({
    order: index + 1,
    phase: `Phase ${Math.floor(index / 2) + 1}`,
    skill,
    reason: missingSkills.some(
      x => x.toLowerCase() === skill.toLowerCase()
    )
      ? `This skill is missing for your ${targetRole} target.`
      : `This skill is already present but should be strengthened for ${targetRole}.`,
    prerequisite:
      index === 0
        ? "None"
        : prioritySkills[index - 1],
    estimatedHours: index < 2 ? 20 : 30,
    topics: [
      `${skill} fundamentals`,
      `${skill} practical concepts`,
      `${skill} real-world usage`,
    ],
    practice: [
      `Solve practical ${skill} exercises`,
      `Build small tasks using ${skill}`,
    ],
    project:
      `Build a ${skill}-based project related to ${targetRole}.`,
    checkpoint:
      `Complete a practical ${skill} project without following a tutorial.`,
  }))

  const readiness = Math.max(
    10,
    Math.min(
      95,
      Math.round(
        (strengthSkills.length / Math.max(requiredSkills.length, 1)) * 100
      )
    )
  )

  return {
    targetRole,
    readiness,
    summary:
      `You have ${strengthSkills.length} relevant strengths and ${missingSkills.length} important skill gaps for ${targetRole}. Focus first on the highest-priority missing skills before moving to advanced topics.`,

    strengths: strengthSkills,

    currentSkills,
    requiredSkills,

    missingSkills,
    weakSkills,

    prioritySkills,

    skillGaps: requiredSkills.map(skill => ({
      skill,
      status: current.has(skill.toLowerCase())
        ? "strength"
        : "missing",
      priority: missingSkills.includes(skill)
        ? "high"
        : "medium",
      reason: current.has(skill.toLowerCase())
        ? `You already have exposure to ${skill}.`
        : `${skill} is required for your target role.`,
    })),

    roadmap,

    jobFit: {
      score: readiness,
      explanation:
        `Your current profile has approximately ${readiness}% coverage of the core skills identified for ${targetRole}.`,
    },

    aiAvailable: false,
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))

    const suppliedProfile = body?.profile

    const supabase = await createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { data: dbProfile } = await supabase
      .from("profiles")
      .select(
        "target_role, skills, experience_level, education, bio"
      )
      .eq("id", user.id)
      .maybeSingle()

    const profile = {
      ...(dbProfile ?? {}),
      ...(suppliedProfile ?? {}),
    }

    const targetRole =
      typeof profile.target_role === "string" &&
      profile.target_role.trim()
        ? profile.target_role.trim()
        : "Software Engineer"

    const currentSkills = skills(profile.skills)

    const fallbackResult = fallback(profile)

    const ai = await groqJSON<SkillAnalysis>(
      `You are SkillBridge's expert AI Career Coach.

You must perform a REAL personalized skill-gap analysis.

TARGET ROLE:
${targetRole}

CURRENT SKILLS:
${
  currentSkills.length
    ? currentSkills.join(", ")
    : "No skills provided"
}

EXPERIENCE LEVEL:
${profile.experience_level || "Not provided"}

Your task:

1. Determine the real skills required for the target role.
2. Compare them against the user's current skills.
3. Identify strengths.
4. Identify missing skills.
5. Identify weak skills.
6. Explain WHY each gap matters.
7. Rank gaps by HIGH/MEDIUM/LOW priority.
8. Calculate realistic job readiness from the comparison.
9. Create a prerequisite-based learning roadmap.
10. DO NOT simply copy the user's current skills.
11. DO NOT include the target role itself as a skill.
12. Return 5-10 important roadmap skills.
13. Start from fundamentals when prerequisites are missing.
14. Each roadmap item must include topics, practice and a project.
15. The roadmap must be practical for a student trying to become job-ready.
16. Be specific to the target role.
17. Do not make generic motivational statements.
18. Return ONLY valid JSON.

JSON FORMAT:

{
  "targetRole": "string",
  "readiness": 0,
  "summary": "specific analysis",
  "strengths": ["skill"],
  "currentSkills": ["skill"],
  "requiredSkills": ["skill"],
  "missingSkills": ["skill"],
  "weakSkills": ["skill"],
  "prioritySkills": ["skill"],
  "skillGaps": [
    {
      "skill": "string",
      "status": "missing",
      "priority": "high",
      "reason": "specific reason"
    }
  ],
  "roadmap": [
    {
      "order": 1,
      "phase": "Phase 1",
      "skill": "string",
      "reason": "why this comes now",
      "prerequisite": "None",
      "estimatedHours": 25,
      "topics": ["topic1", "topic2"],
      "practice": ["task1", "task2"],
      "project": "project idea",
      "checkpoint": "completion condition"
    }
  ],
  "jobFit": {
    "score": 0,
    "explanation": "specific explanation"
  }
}`,
      `Analyze this student's profile now.

Target role: ${targetRole}

Current skills:
${
  currentSkills.length
    ? currentSkills.join(", ")
    : "None"
}

Experience:
${profile.experience_level || "Unknown"}

Produce the complete personalized analysis and roadmap.`,
      fallbackResult
    )

    const validAI =
      ai &&
      Array.isArray(ai.missingSkills) &&
      Array.isArray(ai.weakSkills) &&
      Array.isArray(ai.prioritySkills) &&
      Array.isArray(ai.roadmap) &&
      ai.roadmap.length > 0

    if (!validAI) {
      return NextResponse.json(fallbackResult)
    }

    return NextResponse.json({
      ...ai,
      targetRole,
      currentSkills,
      aiAvailable: true,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error(
      "Career analysis error:",
      error
    )

    return NextResponse.json(
      {
        ...fallback({
          target_role: "Software Engineer",
          skills: [],
        }),
        aiAvailable: false,
      },
      { status: 200 }
    )
  }
}
