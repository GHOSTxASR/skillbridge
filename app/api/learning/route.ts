import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { groqJSON } from "@/lib/ai/groq"

type RoadmapItem = {
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
}

type Resource = {
  id: string
  title: string
  description: string
  type: "video" | "github" | "documentation"
  url: string
  source: string
  skill: string
  free: boolean
}

function clean(value: unknown): string {
  if (typeof value !== "string") return ""

  return value
    .replace(/[^\w\s.+#/&-]/g, "")
    .trim()
}

function normalizeSkills(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map(clean)
    .filter(Boolean)
    .filter((skill, index, array) => {
      return (
        array.findIndex(
          (x) => x.toLowerCase() === skill.toLowerCase()
        ) === index
      )
    })
}

function documentation(skill: string): string | null {
  const key = skill.toLowerCase()

  const map: Record<string, string> = {
    python: "https://docs.python.org/3/",
    javascript:
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
    typescript:
      "https://www.typescriptlang.org/docs/",
    "html & css":
      "https://developer.mozilla.org/en-US/docs/Learn_web_development/Core",
    react: "https://react.dev/learn",
    "next.js": "https://nextjs.org/docs",
    "node.js": "https://nodejs.org/docs/latest/api/",
    git: "https://git-scm.com/doc",
    sql: "https://www.postgresql.org/docs/",
    postgresql: "https://www.postgresql.org/docs/",
    mongodb: "https://www.mongodb.com/docs/",
    docker: "https://docs.docker.com/get-started/",
    aws: "https://docs.aws.amazon.com/",
    linux: "https://www.linux.org/",
    "rest apis":
      "https://developer.mozilla.org/en-US/docs/Glossary/REST",
    "machine learning":
      "https://scikit-learn.org/stable/user_guide.html",
    "scikit-learn":
      "https://scikit-learn.org/stable/user_guide.html",
    pandas: "https://pandas.pydata.org/docs/",
    numpy: "https://numpy.org/doc/",
    statistics:
      "https://docs.scipy.org/doc/scipy/tutorial/stats.html",
    "data visualization":
      "https://matplotlib.org/stable/users/index.html",
  }

  return map[key] ?? null
}

function resourcesForSkill(skill: string): Resource[] {
  const result: Resource[] = []
  const encoded = encodeURIComponent(skill)

  const docs = documentation(skill)

  if (docs) {
    result.push({
      id: `docs-${skill}`,
      title: `${skill} Official Documentation`,
      description:
        `Official documentation and learning material for ${skill}.`,
      type: "documentation",
      url: docs,
      source: "Official Documentation",
      skill,
      free: true,
    })
  }

  result.push({
    id: `github-${skill}`,
    title: `${skill} Open Source Projects`,
    description:
      `Real open-source repositories and projects for ${skill}.`,
    type: "github",
    url: `https://github.com/search?q=${encoded}&type=repositories`,
    source: "GitHub",
    skill,
    free: true,
  })

  result.push({
    id: `youtube-${skill}`,
    title: `${skill} Full Courses & Projects`,
    description:
      `Courses, tutorials and project-based learning for ${skill}.`,
    type: "video",
    url:
      `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `${skill} full course project tutorial`
      )}`,
    source: "YouTube",
    skill,
    free: true,
  })

  return result
}

export async function GET() {
  try {
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("target_role, skills, experience_level")
      .eq("id", user.id)
      .maybeSingle()

    const targetRole =
      typeof profile?.target_role === "string" &&
      profile.target_role.trim()
        ? profile.target_role.trim()
        : "Software Engineer"

    const currentSkills = normalizeSkills(profile?.skills)

    const fallbackItems: RoadmapItem[] = [
      {
        order: 1,
        phase: "Foundation",
        skill:
          currentSkills[0] ?? "Core Programming",
        reason:
          `Build a strong foundation for the ${targetRole} career path.`,
        prerequisite: "None",
        estimatedHours: 25,
        topics: [
          "Fundamentals",
          "Problem solving",
          "Practical usage",
        ],
        practice: [
          "Complete practical exercises",
          "Solve beginner problems",
        ],
        project:
          `Build a small project related to ${targetRole}.`,
        checkpoint:
          "Complete the project independently.",
      },
      {
        order: 2,
        phase: "Core Skills",
        skill: "Data Structures & Algorithms",
        reason:
          `Strengthen problem-solving ability for ${targetRole}.`,
        prerequisite:
          currentSkills[0] ?? "Basic programming",
        estimatedHours: 35,
        topics: [
          "Arrays",
          "Strings",
          "Hashing",
          "Searching",
          "Sorting",
        ],
        practice: [
          "Solve coding problems",
          "Implement common algorithms",
        ],
        project:
          "Build a problem-solving project.",
        checkpoint:
          "Solve intermediate problems without assistance.",
      },
      {
        order: 3,
        phase: "Projects",
        skill: "Git",
        reason:
          "Version control is essential for real software projects.",
        prerequisite: "Basic programming",
        estimatedHours: 12,
        topics: [
          "Commits",
          "Branches",
          "Merge",
          "Pull requests",
        ],
        practice: [
          "Create repositories",
          "Practice branching workflows",
        ],
        project:
          "Publish a portfolio project on GitHub.",
        checkpoint:
          "Complete a Git-based project workflow.",
      },
    ]

    const ai = await groqJSON<{
      analysis?: string
      roadmap?: RoadmapItem[]
    }>(
      `You are SkillBridge's AI Learning Advisor.

Analyze the learner for their target role and create a realistic learning roadmap.

Target role:
${targetRole}

Current skills:
${
  currentSkills.length
    ? currentSkills.join(", ")
    : "None provided"
}

Experience level:
${
  typeof profile?.experience_level === "string" &&
  profile.experience_level.trim()
    ? profile.experience_level
    : "Not specified"
}

Your job:
1. Analyze what the learner needs for the target role.
2. Identify missing or weak skills.
3. Recommend the most important skills.
4. Prioritize skills logically.
5. Create a prerequisite-based learning order.
6. Do not simply repeat the learner's existing skills.
7. Do not include the target role itself as a skill.
8. Return 5-10 roadmap items.
9. Keep recommendations practical and job-oriented.

For every roadmap item return:
order
phase
skill
reason
prerequisite
estimatedHours
topics
practice
project
checkpoint

Also return:
analysis

The analysis should be a concise explanation of what the learner should focus on and why.

Return ONLY JSON.`,
      `Analyze this learner and build the best learning roadmap for ${targetRole}.`,
      {
        analysis:
          `For the ${targetRole} role, focus on the most important missing skills and learn them in prerequisite order.`,
        roadmap: fallbackItems,
      }
    )

    const roadmap =
      Array.isArray(ai?.roadmap) && ai.roadmap.length > 0
        ? ai.roadmap
        : fallbackItems

    const normalizedRoadmap: RoadmapItem[] = roadmap
      .map((item, index) => ({
        order: index + 1,
        phase:
          typeof item.phase === "string" && item.phase.trim()
            ? item.phase.trim()
            : `Phase ${Math.floor(index / 2) + 1}`,
        skill: clean(item.skill),
        reason:
          typeof item.reason === "string" && item.reason.trim()
            ? item.reason.trim()
            : "Important for the target role.",
        prerequisite:
          typeof item.prerequisite === "string" &&
          item.prerequisite.trim()
            ? item.prerequisite.trim()
            : "None",
        estimatedHours:
          typeof item.estimatedHours === "number" &&
          item.estimatedHours > 0
            ? Math.round(item.estimatedHours)
            : 25,
        topics: Array.isArray(item.topics)
          ? item.topics.map(clean).filter(Boolean)
          : [],
        practice: Array.isArray(item.practice)
          ? item.practice.map(clean).filter(Boolean)
          : [],
        project:
          typeof item.project === "string" && item.project.trim()
            ? item.project.trim()
            : "Build a practical project.",
        checkpoint:
          typeof item.checkpoint === "string" &&
          item.checkpoint.trim()
            ? item.checkpoint.trim()
            : "Complete the practical project.",
      }))
      .filter((item) => item.skill)
      .slice(0, 10)

    const resources = normalizedRoadmap.flatMap(
      (item) => resourcesForSkill(item.skill)
    )

    const totalHours = normalizedRoadmap.reduce(
      (sum, item) => sum + item.estimatedHours,
      0
    )

    return NextResponse.json({
      targetRole,
      currentSkills,
      aiSummary:
        typeof ai?.analysis === "string" && ai.analysis.trim()
          ? ai.analysis.trim()
          : `AI recommendations for your ${targetRole} career path.`,
      recommendedSkills: normalizedRoadmap.map(
        (item) => item.skill
      ),
      skills: normalizedRoadmap,
      resources,
      totalHours,
      totalSkills: normalizedRoadmap.length,
      sources: {
        github: true,
        youtube: true,
        documentation: true,
      },
      generatedAt: new Date().toISOString(),
      aiAvailable:
        Array.isArray(ai?.roadmap) &&
        ai.roadmap.length > 0,
    })
  } catch (error) {
    console.error("Learning roadmap error:", error)

    return NextResponse.json({
      targetRole: "Software Engineer",
      currentSkills: [],
      aiSummary:
        "AI recommendations are temporarily unavailable. A basic learning roadmap is being shown.",
      recommendedSkills: [],
      skills: [],
      resources: [],
      totalHours: 0,
      totalSkills: 0,
      sources: {
        github: false,
        youtube: false,
        documentation: false,
      },
      generatedAt: new Date().toISOString(),
      aiAvailable: false,
    })
  }
}
