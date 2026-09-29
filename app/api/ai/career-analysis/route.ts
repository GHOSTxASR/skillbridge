import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { groqJSONOutcome, groqModel } from "@/lib/ai/groq"
import { shareInFlight } from "@/lib/ai/in-flight"
import { admitGeneration, rateLimitedResponse } from "@/lib/ai/rate-limit"
import {
  loadCareerProfile,
  type CareerProfile,
} from "@/lib/ai/profile-input"

// Part of every stored analysis's input hash. Bump it whenever SYSTEM_PROMPT, the Groq
// options or readAnalysis() changes, so older stored analyses are regenerated.
const CAREER_PROMPT_VERSION = "career-v1"

// Same limit as the career_analyses.analysis check constraint.
const MAX_STORED_ANALYSIS_LENGTH = 100_000

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

// The body carries nothing the analysis needs: it always uses the signed-in user's saved
// profile. Older clients send { profile: {...} }; its shape is checked but never used.
const MAX_BODY_LENGTH = 20_000

function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
}

function badRequest(error: string) {
  return NextResponse.json(
    { error, aiAvailable: false },
    { status: 400 }
  )
}

function fallback(
  targetRole: string,
  currentSkills: string[]
): SkillAnalysis {
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

// --- AI output validation -------------------------------------------------------------
// The model's JSON is untrusted: every field is type-checked and bounded, and an answer
// missing a core field is rejected rather than shown as an AI analysis.

function text(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : ""
}

function list(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value)) return null

  const seen = new Set<string>()
  const items: string[] = []

  for (const item of value) {
    if (items.length === maxItems) break

    const entry = text(item, 80)
    if (!entry || seen.has(entry.toLowerCase())) continue

    seen.add(entry.toLowerCase())
    items.push(entry)
  }

  return items
}

function score(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  otherwise: T
): T {
  return allowed.includes(value as T) ? (value as T) : otherwise
}

type AIAnalysis = Omit<
  SkillAnalysis,
  "targetRole" | "currentSkills" | "aiAvailable"
>

function readAnalysis(data: unknown): AIAnalysis | null {
  if (!isPlainObject(data)) return null

  const readiness = score(data.readiness)
  const summary = text(data.summary, 1000)
  const strengths = list(data.strengths, 15)
  const missingSkills = list(data.missingSkills, 15)
  const weakSkills = list(data.weakSkills, 10)
  const prioritySkills = list(data.prioritySkills, 10)

  if (
    readiness === null ||
    !summary ||
    !strengths ||
    !missingSkills ||
    !weakSkills ||
    !prioritySkills ||
    !Array.isArray(data.roadmap)
  ) {
    return null
  }

  const roadmap = data.roadmap
    .filter(isPlainObject)
    .map((item) => ({
      skill: text(item.skill, 80),
      phase: text(item.phase, 40),
      reason: text(item.reason, 300),
      prerequisite: text(item.prerequisite, 120) || "None",
      estimatedHours:
        typeof item.estimatedHours === "number" &&
        Number.isFinite(item.estimatedHours) &&
        item.estimatedHours > 0
          ? Math.min(500, Math.round(item.estimatedHours))
          : 25,
      topics: list(item.topics, 6) ?? [],
      practice: list(item.practice, 4) ?? [],
      project: text(item.project, 300),
      checkpoint: text(item.checkpoint, 300),
    }))
    .filter((item) => item.skill)
    .slice(0, 10)
    .map((item, index) => ({
      order: index + 1,
      ...item,
      phase: item.phase || `Phase ${index + 1}`,
    }))

  if (roadmap.length === 0) return null

  const skillGaps = Array.isArray(data.skillGaps)
    ? data.skillGaps
        .filter(isPlainObject)
        .map((gap) => ({
          skill: text(gap.skill, 80),
          status: oneOf(gap.status, ["missing", "weak", "strength"] as const, "missing"),
          priority: oneOf(gap.priority, ["high", "medium", "low"] as const, "medium"),
          reason: text(gap.reason, 300),
        }))
        .filter((gap) => gap.skill)
        .slice(0, 20)
    : []

  const jobFit = isPlainObject(data.jobFit) ? data.jobFit : {}

  return {
    readiness,
    summary,
    strengths,
    // Not requested from the model (it only repeated the other lists); rebuilt here.
    requiredSkills: list(
      [...strengths, ...weakSkills, ...missingSkills],
      20
    ) ?? [],
    missingSkills,
    weakSkills,
    prioritySkills,
    skillGaps,
    roadmap,
    jobFit: {
      score: score(jobFit.score) ?? readiness,
      explanation: text(jobFit.explanation, 600),
    },
  }
}

// --- Persistent cache (public.career_analyses) ------------------------------------------

// Case and spacing do not change what an analysis is for, so they do not change the key.
function keyText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

// Deterministic key for "same inputs, same model, same prompt". It covers everything the
// prompt is built from; the user id is not part of it (each user has one row).
function careerInputHash(profile: CareerProfile, model: string): string {
  const skills = Array.from(new Set(profile.skills.map(keyText))).sort()

  return createHash("sha256")
    .update(
      JSON.stringify({
        targetRole: keyText(profile.targetRole),
        experience: keyText(profile.experience),
        skills,
        model,
        promptVersion: CAREER_PROMPT_VERSION,
      })
    )
    .digest("hex")
}

type StoredAnalysis = { analysis: AIAnalysis; generatedAt: string }

// A stored row is reused only for the same inputs, model and prompt version, when it is
// marked as AI output, within size limits and still valid under readAnalysis().
function usableStoredAnalysis(
  row: unknown,
  inputHash: string,
  model: string
): StoredAnalysis | null {
  if (
    !isPlainObject(row) ||
    row.input_hash !== inputHash ||
    row.model !== model ||
    row.prompt_version !== CAREER_PROMPT_VERSION ||
    !isPlainObject(row.analysis) ||
    row.analysis.aiAvailable !== true ||
    JSON.stringify(row.analysis).length > MAX_STORED_ANALYSIS_LENGTH
  ) {
    return null
  }

  const analysis = readAnalysis(row.analysis)
  const generatedAt =
    typeof row.generated_at === "string" ? new Date(row.generated_at) : null

  if (!analysis || !generatedAt || Number.isNaN(generatedAt.getTime())) {
    return null
  }

  return { analysis, generatedAt: generatedAt.toISOString() }
}

// retryAfterSeconds is set only when the per-user limit refused the generation.
type Generation =
  | { ok: true; analysis: AIAnalysis; generatedAt: string }
  | { ok: false; reason: string; retryAfterSeconds?: number }

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

// One admission and one Groq call; a validated result is stored for the user, anything
// else is not.
async function generateAnalysis(
  supabase: ServerClient,
  userId: string,
  profile: CareerProfile,
  inputHash: string,
  model: string
): Promise<Generation> {
  const admission = await admitGeneration(supabase, "career_analysis")

  if (!admission.allowed) {
    return admission.reason === "rate_limited"
      ? {
          ok: false,
          reason: "limit_reached",
          retryAfterSeconds: admission.retryAfterSeconds,
        }
      : { ok: false, reason: "unavailable" }
  }

  // Low reasoning effort: on gpt-oss the hidden reasoning shares the output token cap,
  // and long reasoning left too little room for the JSON (truncated or empty replies).
  const ai = await groqJSONOutcome(
    SYSTEM_PROMPT,
    `Target role: ${profile.targetRole}
Current skills: ${profile.skills.length ? profile.skills.join(", ") : "None"}
Experience: ${profile.experience || "Not provided"}`,
    { reasoningEffort: "low" }
  )

  const analysis = ai.ok ? readAnalysis(ai.data) : null

  if (!analysis) {
    if (ai.ok) {
      console.error("Career analysis: AI output failed validation", {
        model: ai.model,
      })
    }

    return { ok: false, reason: ai.ok ? "invalid_output" : ai.reason }
  }

  const generatedAt = new Date().toISOString()

  // A failed write still returns the new analysis; it is simply regenerated next time.
  const { error } = await supabase
    .from("career_analyses")
    .upsert(
      {
        user_id: userId,
        input_hash: inputHash,
        analysis: { ...analysis, aiAvailable: true },
        model,
        generated_at: generatedAt,
        prompt_version: CAREER_PROMPT_VERSION,
      },
      { onConflict: "user_id" }
    )

  if (error) {
    console.error("Career analysis cache write failed:", error.code ?? "unknown")
  }

  return { ok: true, analysis, generatedAt }
}

// Compact on purpose: the previous open-ended schema regularly ran past the output
// token cap and came back as truncated JSON.
const SYSTEM_PROMPT = `You are SkillBridge's expert AI Career Coach. Compare the student's current skills with what the target role needs and plan what to learn next.

Rules:
- Be specific to the target role. No generic motivation.
- Never list the target role itself as a skill. Do not copy the student's skills into the gaps.
- readiness and jobFit.score are your own estimate, from 0 to 100, of how much of the role's core skill set the student already has.
- Keep every text short: summary at most 60 words; each reason, explanation, project and checkpoint at most 20 words; each topic and practice item at most 6 words.
- Limits: strengths up to 8, missingSkills up to 8, weakSkills up to 5, prioritySkills up to 6, skillGaps up to 8, roadmap 5 to 6 items in prerequisite order, topics up to 3 per item, practice up to 2 per item.
- status is one of missing, weak, strength. priority is one of high, medium, low.
- Output minified JSON on a single line, with exactly these keys. Values in angle brackets only describe the type; replace them with real values:
{"readiness":<integer 0-100>,"summary":"<text>","strengths":["<skill>"],"missingSkills":["<skill>"],"weakSkills":["<skill>"],"prioritySkills":["<skill>"],"skillGaps":[{"skill":"<skill>","status":"<missing|weak|strength>","priority":"<high|medium|low>","reason":"<text>"}],"roadmap":[{"order":<integer>,"phase":"<text>","skill":"<skill>","reason":"<text>","prerequisite":"<skill or None>","estimatedHours":<integer>,"topics":["<text>"],"practice":["<text>"],"project":"<text>","checkpoint":"<text>"}],"jobFit":{"score":<integer 0-100>,"explanation":"<text>"}}`

export async function POST(request: Request) {
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

    const rawBody = await request.text()

    if (rawBody.length > MAX_BODY_LENGTH) {
      return badRequest("Request body too large")
    }

    let body: unknown = {}

    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        return badRequest("Invalid JSON body")
      }
    }

    if (
      !isPlainObject(body) ||
      (body.profile !== undefined &&
        body.profile !== null &&
        !isPlainObject(body.profile))
    ) {
      return badRequest("Invalid request body")
    }

    const loaded = await loadCareerProfile(supabase, user.id)

    if (loaded.status === "missing") {
      return NextResponse.json(
        { error: "Profile setup required", aiAvailable: false },
        { status: 409 }
      )
    }

    if (loaded.status === "error") {
      return NextResponse.json(
        { error: "Profile unavailable", aiAvailable: false },
        { status: 503 }
      )
    }

    const profile = loaded.profile
    const { targetRole, skills: currentSkills } = profile

    const model = groqModel()
    const inputHash = careerInputHash(profile, model)

    // ?refresh=1 is the explicit "analyze again" action; everything else is cache-aware.
    const refresh =
      new URL(request.url).searchParams.get("refresh") === "1"

    // RLS limits this to the signed-in user's own row.
    const { data: storedRow, error: readError } = await supabase
      .from("career_analyses")
      .select("input_hash, analysis, model, generated_at, prompt_version")
      .eq("user_id", user.id)
      .maybeSingle()

    if (readError) {
      console.error("Career analysis cache read failed:", readError.code ?? "unknown")
    }

    const stored = usableStoredAnalysis(storedRow, inputHash, model)

    if (stored && !refresh) {
      return NextResponse.json({
        ...stored.analysis,
        targetRole,
        currentSkills,
        aiAvailable: true,
        cached: true,
        generatedAt: stored.generatedAt,
      })
    }

    // Only a cache miss or ?refresh=1 gets here. Identical concurrent requests (same user,
    // same inputs) share one admission and one Groq call.
    const generated = await shareInFlight(
      `career-analysis:${user.id}:${inputHash}`,
      () => generateAnalysis(supabase, user.id, profile, inputHash, model)
    )

    // Over the per-user limit: refused before any Groq call, even for a refresh that
    // has a saved analysis to fall back on.
    if (!generated.ok && generated.retryAfterSeconds !== undefined) {
      return rateLimitedResponse(generated.retryAfterSeconds, {
        aiAvailable: false,
      })
    }

    if (generated.ok) {
      return NextResponse.json({
        ...generated.analysis,
        targetRole,
        currentSkills,
        aiAvailable: true,
        cached: false,
        generatedAt: generated.generatedAt,
      })
    }

    // No new AI analysis. A valid stored one is kept and returned (a failed refresh never
    // replaces it); without one, the estimate is returned, marked as not AI.
    if (stored) {
      return NextResponse.json({
        ...stored.analysis,
        targetRole,
        currentSkills,
        aiAvailable: true,
        cached: true,
        generatedAt: stored.generatedAt,
        reason: generated.reason,
      })
    }

    return NextResponse.json({
      ...fallback(targetRole, currentSkills),
      reason: generated.reason,
    })
  } catch (error) {
    console.error(
      "Career analysis error:",
      error instanceof Error ? error.message : "unknown error"
    )

    return NextResponse.json(
      { error: "Career analysis failed", aiAvailable: false },
      { status: 500 }
    )
  }
}
