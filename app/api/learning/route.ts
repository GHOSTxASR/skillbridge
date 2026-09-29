import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { groqJSON } from "@/lib/ai/groq"
import { shareInFlight } from "@/lib/ai/in-flight"
import { admitGeneration, rateLimitedResponse } from "@/lib/ai/rate-limit"
import { loadSkillCatalog, resolveSkill } from "@/lib/skills/catalog"
import { recordRoadmapVersion } from "@/lib/skills/roadmap-versions"

// Part of every stored roadmap's input hash. Bump it whenever the prompt, the Groq
// options or the roadmap normalization changes, so older stored roadmaps are regenerated.
const LEARNING_PROMPT_VERSION = "v1"

// Must resolve the model exactly like getModel() in lib/ai/groq.ts (not exported), so
// the model recorded with a stored roadmap is the one that generated it.
const DEFAULT_GROQ_MODEL = "llama-3.1-8b"

const MAX_ROADMAP_ITEMS = 10

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

type LearningResult = {
  roadmap: RoadmapItem[]
  aiSummary: string | null
  generatedAt: string
}

// retryAfterSeconds is set only when the per-user limit refused the generation.
type RoadmapGeneration =
  | ({ ok: true } & LearningResult)
  | { ok: false; retryAfterSeconds?: number }

function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  )
}

function clean(value: unknown): string {
  if (typeof value !== "string") return ""

  return value
    .replace(/[^\w\s.+#/&-]/g, "")
    .trim()
}

function normalizeSkills(value: unknown): string[] {
  // profiles.skills is an array (assessment page) or a comma-separated string
  // (account page); both go through the same normalization.
  const items =
    typeof value === "string" ? value.split(",") : value

  if (!Array.isArray(items)) return []

  return items
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

function currentModel(): string {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL
}

// Case and spacing do not change what a roadmap is for, so they do not change the key.
function keyText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

// Deterministic key for "same learner inputs, same model, same prompt". The user id is
// not part of it: each user has one row, keyed by user_id.
function learningInputHash(input: {
  targetRole: string
  experienceLevel: string
  skills: string[]
  model: string
}): string {
  const skills = Array.from(
    new Set(input.skills.map(keyText))
  ).sort()

  return createHash("sha256")
    .update(
      JSON.stringify({
        targetRole: keyText(input.targetRole),
        experienceLevel: keyText(input.experienceLevel),
        skills,
        model: input.model,
        promptVersion: LEARNING_PROMPT_VERSION,
      })
    )
    .digest("hex")
}

function normalizeRoadmap(items: unknown[]): RoadmapItem[] {
  return items
    .filter(isPlainObject)
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
        Number.isFinite(item.estimatedHours) &&
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
    .slice(0, MAX_ROADMAP_ITEMS)
}

// groqJSON returns its fallback argument (null here) when every key fails or the reply
// is not JSON, so only a parsed object with at least one usable item is an AI roadmap.
function readAiRoadmap(
  ai: unknown
): Omit<LearningResult, "generatedAt"> | null {
  if (!isPlainObject(ai) || !Array.isArray(ai.roadmap)) return null

  const roadmap = normalizeRoadmap(ai.roadmap)

  if (roadmap.length === 0) return null

  return {
    roadmap,
    aiSummary: isNonEmptyString(ai.analysis)
      ? ai.analysis.trim()
      : null,
  }
}

// Exactly the item shape normalizeRoadmap() writes; anything else is not reused.
function isStoredRoadmapItem(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.order === "number" &&
    Number.isInteger(value.order) &&
    value.order > 0 &&
    isNonEmptyString(value.phase) &&
    typeof value.skill === "string" &&
    value.skill !== "" &&
    clean(value.skill) === value.skill &&
    isNonEmptyString(value.reason) &&
    isNonEmptyString(value.prerequisite) &&
    typeof value.estimatedHours === "number" &&
    Number.isInteger(value.estimatedHours) &&
    value.estimatedHours >= 0 &&
    isStringArray(value.topics) &&
    isStringArray(value.practice) &&
    isNonEmptyString(value.project) &&
    isNonEmptyString(value.checkpoint)
  )
}

// A stored roadmap is reused only for the same inputs, model and prompt version, and
// only if it is still structurally what this route writes.
function usableStoredRoadmap(
  row: unknown,
  inputHash: string,
  model: string
): LearningResult | null {
  if (
    !isPlainObject(row) ||
    row.input_hash !== inputHash ||
    row.model !== model ||
    row.prompt_version !== LEARNING_PROMPT_VERSION
  ) {
    return null
  }

  const roadmap = row.roadmap

  if (
    !Array.isArray(roadmap) ||
    roadmap.length === 0 ||
    roadmap.length > MAX_ROADMAP_ITEMS ||
    !roadmap.every(isStoredRoadmapItem)
  ) {
    return null
  }

  if (row.ai_summary !== null && typeof row.ai_summary !== "string") {
    return null
  }

  const generatedAt =
    typeof row.generated_at === "string"
      ? new Date(row.generated_at)
      : null

  if (!generatedAt || Number.isNaN(generatedAt.getTime())) {
    return null
  }

  return {
    // jsonb reorders keys and could hold extra ones: rebuild each item field by field.
    roadmap: (roadmap as RoadmapItem[]).map((item) => ({
      order: item.order,
      phase: item.phase,
      skill: item.skill,
      reason: item.reason,
      prerequisite: item.prerequisite,
      estimatedHours: item.estimatedHours,
      topics: item.topics,
      practice: item.practice,
      project: item.project,
      checkpoint: item.checkpoint,
    })),
    aiSummary: isNonEmptyString(row.ai_summary)
      ? row.ai_summary.trim()
      : null,
    generatedAt: generatedAt.toISOString(),
  }
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

// Records the trusted version of a freshly generated roadmap: each step's skill resolved
// with the one catalog resolver (unmatched and compound skills stay null, never guessed).
// Best effort: the roadmap is returned and cached whether or not this succeeds.
async function recordTrustedVersion(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  inputHash: string,
  model: string,
  generatedAt: string,
  roadmap: RoadmapItem[]
) {
  try {
    const catalog = await loadSkillCatalog(supabase)
    if (!catalog) {
      console.error("Roadmap version not recorded: skill catalog unavailable")
      return
    }
    await recordRoadmapVersion({
      userId,
      inputHash,
      model,
      promptVersion: LEARNING_PROMPT_VERSION,
      generatedAt,
      steps: roadmap.map((item) => ({
        order: item.order,
        phase: item.phase || null,
        skill: item.skill,
        skillId: resolveSkill(catalog, item.skill).skill?.id ?? null,
        reason: item.reason || null,
      })),
    })
  } catch {
    console.error("Roadmap version not recorded: unexpected error")
  }
}

// Resources are derived from the skill names, so they are rebuilt here, never stored.
function learningResponse(input: {
  targetRole: string
  currentSkills: string[]
  roadmap: RoadmapItem[]
  aiSummary: string
  generatedAt: string
  aiAvailable: boolean
}) {
  return NextResponse.json({
    targetRole: input.targetRole,
    currentSkills: input.currentSkills,
    aiSummary: input.aiSummary,
    recommendedSkills: input.roadmap.map(
      (item) => item.skill
    ),
    skills: input.roadmap,
    resources: input.roadmap.flatMap(
      (item) => resourcesForSkill(item.skill)
    ),
    totalHours: input.roadmap.reduce(
      (sum, item) => sum + item.estimatedHours,
      0
    ),
    totalSkills: input.roadmap.length,
    sources: {
      github: true,
      youtube: true,
      documentation: true,
    },
    generatedAt: input.generatedAt,
    aiAvailable: input.aiAvailable,
  })
}

// GET /api/learning reuses the user's stored roadmap while their inputs are unchanged;
// GET /api/learning?refresh=1 always asks Groq for a new one.
export async function GET(request: Request) {
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

    const refresh =
      new URL(request.url).searchParams.get("refresh") === "1"

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

    const experienceLevel =
      typeof profile?.experience_level === "string" &&
      profile.experience_level.trim()
        ? profile.experience_level.trim()
        : "Not specified"

    const model = currentModel()

    const inputHash = learningInputHash({
      targetRole,
      experienceLevel,
      skills: currentSkills,
      model,
    })

    const defaultAiSummary =
      `AI recommendations for your ${targetRole} career path.`

    // RLS limits this to the signed-in user's own row.
    const { data: storedRow, error: readError } = await supabase
      .from("learning_roadmaps")
      .select(
        "input_hash, roadmap, ai_summary, model, generated_at, prompt_version"
      )
      .eq("user_id", user.id)
      .maybeSingle()

    if (readError) {
      console.error(
        "Learning roadmap cache read failed:",
        readError.message
      )
    }

    const stored = usableStoredRoadmap(storedRow, inputHash, model)

    if (stored && !refresh) {
      return learningResponse({
        targetRole,
        currentSkills,
        roadmap: stored.roadmap,
        aiSummary: stored.aiSummary ?? defaultAiSummary,
        generatedAt: stored.generatedAt,
        aiAvailable: true,
      })
    }

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

    // Only a cache miss or ?refresh=1 gets here. Identical concurrent requests (same user,
    // same inputs) share one admission, one Groq call and one write.
    const generation = await shareInFlight(
      `learning:${user.id}:${inputHash}`,
      async (): Promise<RoadmapGeneration> => {
        const admission = await admitGeneration(supabase, "learning")

        if (!admission.allowed) {
          return admission.reason === "rate_limited"
            ? { ok: false, retryAfterSeconds: admission.retryAfterSeconds }
            : { ok: false }
        }

        const ai = await groqJSON<unknown>(
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
${experienceLevel}

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
          null
        )

        const generated = readAiRoadmap(ai)

        if (!generated) return { ok: false }

        const generatedAt = new Date().toISOString()

        // learning_roadmaps.user_id references profiles(id), so without a profile row
        // the write could only fail. A failed write still returns the new roadmap.
        if (profile) {
          // The immutable, server-written copy that roadmap learning evidence is built from.
          // It never blocks or changes the roadmap; learning_roadmaps below stays the
          // display cache.
          await recordTrustedVersion(supabase, user.id, inputHash, model, generatedAt, generated.roadmap)

          const { error: writeError } = await supabase
            .from("learning_roadmaps")
            .upsert(
              {
                user_id: user.id,
                input_hash: inputHash,
                roadmap: generated.roadmap,
                ai_summary: generated.aiSummary,
                model,
                generated_at: generatedAt,
                prompt_version: LEARNING_PROMPT_VERSION,
              },
              { onConflict: "user_id" }
            )

          if (writeError) {
            console.error(
              "Learning roadmap cache write failed:",
              writeError.message
            )
          }
        }

        return { ok: true, ...generated, generatedAt }
      }
    )

    if (generation.ok) {
      return learningResponse({
        targetRole,
        currentSkills,
        roadmap: generation.roadmap,
        aiSummary: generation.aiSummary ?? defaultAiSummary,
        generatedAt: generation.generatedAt,
        aiAvailable: true,
      })
    }

    // Over the per-user limit: refused before any Groq call, even for a refresh that
    // has a stored roadmap to fall back on.
    if (generation.retryAfterSeconds !== undefined) {
      return rateLimitedResponse(generation.retryAfterSeconds)
    }

    // No AI roadmap. Nothing is written, so a stored AI roadmap is never replaced by the
    // fallback; a failed refresh keeps serving the stored roadmap if it still matches.
    if (stored) {
      return learningResponse({
        targetRole,
        currentSkills,
        roadmap: stored.roadmap,
        aiSummary: stored.aiSummary ?? defaultAiSummary,
        generatedAt: stored.generatedAt,
        aiAvailable: true,
      })
    }

    return learningResponse({
      targetRole,
      currentSkills,
      roadmap: normalizeRoadmap(fallbackItems),
      aiSummary:
        `For the ${targetRole} role, focus on the most important missing skills and learn them in prerequisite order.`,
      generatedAt: new Date().toISOString(),
      aiAvailable: false,
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
