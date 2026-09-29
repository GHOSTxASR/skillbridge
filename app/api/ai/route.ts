import { NextResponse } from "next/server"
import {
  groqChatOutcome,
  groqJSONOutcome,
} from "@/lib/ai/groq"
import { loadCareerProfile } from "@/lib/ai/profile-input"
import { admitGeneration, rateLimitedResponse } from "@/lib/ai/rate-limit"
import { createSupabaseServerClient } from "@/lib/supabase-server"

export const dynamic = "force-dynamic"

// Request-body bounds. A too-long message is rejected; other text is cut to size and
// over-long skill names are dropped, since a partial name is not a skill.
const MAX_BODY_LENGTH = 100_000
const MAX_MESSAGE_LENGTH = 4000
const MAX_ROLE_LENGTH = 150
const MAX_EXPERIENCE_LENGTH = 100
const MAX_SKILLS = 30
const MAX_SKILL_LENGTH = 80
const MAX_JOBS = 15
const MAX_JOB_TITLE_LENGTH = 200
const MAX_JOB_DESCRIPTION_LENGTH = 1500
const MAX_MATCHED_SKILLS = 15

// The request body after runtime validation. role, skills and experience are still
// accepted and checked for older clients, but prompts always use the saved profile;
// only message and jobs come from the request.
type AnalysisInput = {
  role?: string
  skills?: string[]
  experience?: string
  message?: string
  jobs?: Array<{
    title: string
    description: string
    matchedSkills: string[]
  }>
}

type Validation =
  | { ok: true; input: AnalysisInput }
  | { ok: false; error: string; reply?: string }

type Analysis = {
  summary: string
  readiness: number
  strengths: string[]
  gaps: string[]
  prioritySkills: string[]
  roadmap: Array<{
    skill: string
    priority: "high" | "medium" | "low"
    reason: string
  }>
  jobFit: string
}

const fallback: Analysis = {
  summary:
    "Your profile is being analyzed using your current skills and target role.",
  readiness: 0,
  strengths: [],
  gaps: [],
  prioritySkills: [],
  roadmap: [],
  jobFit:
    "AI analysis will update automatically when the AI service is available.",
}

function normalizeNumber(value: unknown): number {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return 0
  }

  return Math.max(
    0,
    Math.min(100, Math.round(number))
  )
}

function normalizeStringArray(
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) =>
      String(item).trim()
    )
    .filter(Boolean)
    .slice(0, 30)
}

function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
}

// Strings only, trimmed, over-long names dropped, case-insensitive dedupe, capped.
function boundedSkills(
  value: unknown[],
  maxItems: number
): string[] {
  const seen = new Set<string>()
  const skills: string[] = []

  for (const item of value) {
    if (skills.length === maxItems) break
    if (typeof item !== "string") continue

    const skill = item.trim()
    if (!skill || skill.length > MAX_SKILL_LENGTH) continue

    const key = skill.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    skills.push(skill)
  }

  return skills
}

// The body is untrusted: accepted fields are type-checked and bounded, unknown fields
// are ignored, and a body that is neither a chat message nor analysis data is rejected
// so it can never fall through to a Groq call. null counts as an omitted field.
function validateRequest(body: unknown): Validation {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be a JSON object" }
  }

  const input: AnalysisInput = {}

  for (const [field, maxLength] of [
    ["role", MAX_ROLE_LENGTH],
    ["experience", MAX_EXPERIENCE_LENGTH],
  ] as const) {
    const value = body[field]
    if (value === undefined || value === null) continue
    if (typeof value !== "string") {
      return { ok: false, error: `Invalid ${field}` }
    }
    input[field] = value.trim().slice(0, maxLength)
  }

  if (body.skills !== undefined && body.skills !== null) {
    if (!Array.isArray(body.skills)) {
      return { ok: false, error: "Invalid skills" }
    }
    input.skills = boundedSkills(body.skills, MAX_SKILLS)
  }

  if (body.jobs !== undefined && body.jobs !== null) {
    if (!Array.isArray(body.jobs)) {
      return { ok: false, error: "Invalid jobs" }
    }

    const jobs: NonNullable<AnalysisInput["jobs"]> = []

    for (const job of body.jobs) {
      if (jobs.length === MAX_JOBS) break
      if (!isPlainObject(job)) continue

      const title =
        typeof job.title === "string"
          ? job.title.trim().slice(0, MAX_JOB_TITLE_LENGTH)
          : ""
      const description =
        typeof job.description === "string"
          ? job.description.trim().slice(0, MAX_JOB_DESCRIPTION_LENGTH)
          : ""
      const matchedSkills = Array.isArray(job.matchedSkills)
        ? boundedSkills(job.matchedSkills, MAX_MATCHED_SKILLS)
        : []

      if (title || description || matchedSkills.length > 0) {
        jobs.push({ title, description, matchedSkills })
      }
    }

    input.jobs = jobs
  }

  if (body.message !== undefined && body.message !== null) {
    if (typeof body.message !== "string") {
      return { ok: false, error: "Invalid message" }
    }

    const message = body.message.trim()

    if (!message) {
      return { ok: false, error: "Message is empty" }
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return {
        ok: false,
        error: "Message too long",
        reply: `Your message is too long. Please keep it under ${MAX_MESSAGE_LENGTH} characters.`,
      }
    }

    input.message = message
  } else if (
    !input.role &&
    !input.experience &&
    !input.skills?.length &&
    !input.jobs?.length
  ) {
    return {
      ok: false,
      error: "Request must include a message or analysis data",
    }
  }

  return { ok: true, input }
}

function invalidRequest(error: string, reply?: string) {
  return NextResponse.json(
    {
      ok: false,
      ai: false,
      ...(reply ? { reply } : {}),
      error,
    },
    { status: 400 }
  )
}

export async function POST(
  request: Request
) {
  try {
    const supabase =
      await createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({
        ok: false,
        ai: false,
        reply:
          "Please log in to use SkillBridge AI.",
        error: "Unauthorized",
      }, { status: 401 })
    }

    const rawBody = await request.text()

    if (rawBody.length > MAX_BODY_LENGTH) {
      return invalidRequest("Request body too large")
    }

    let parsedBody: unknown

    try {
      parsedBody = JSON.parse(rawBody)
    } catch {
      return invalidRequest("Invalid JSON body")
    }

    const validation = validateRequest(parsedBody)

    if (!validation.ok) {
      return invalidRequest(validation.error, validation.reply)
    }

    const body = validation.input

    // The signed-in user's saved profile is the only source of role, skills and
    // experience; the request cannot replace them.
    const loaded = await loadCareerProfile(supabase, user.id)

    if (loaded.status === "error") {
      return NextResponse.json(
        {
          ok: false,
          ai: false,
          reply:
            "SkillBridge could not load your profile right now. Please try again in a moment.",
          error: "Profile unavailable",
        },
        { status: 503 }
      )
    }

    const profile =
      loaded.status === "ok" ? loaded.profile : null

    const role = profile?.targetRole ?? ""
    const skills = profile?.skills ?? []
    const experience =
      profile?.experience || "Not specified"

    const profileContext = profile
      ? `User target role:
${role}

User current skills:
${skills.join(", ") || "None provided"}

User experience:
${experience}`
      : "The user has not finished profile setup yet, so their target role, skills and experience are unknown."

    const jobs = Array.isArray(body.jobs)
      ? body.jobs
          .slice(0, 15)
          .map((job) => ({
            title: String(
              job?.title || ""
            ),
            description: String(
              job?.description || ""
            ).slice(0, 1500),
            matchedSkills:
              Array.isArray(
                job?.matchedSkills
              )
                ? job.matchedSkills
                    .map(String)
                    .slice(0, 15)
                : [],
          }))
      : []

    /*
     * CHAT MODE
     *
     * Returns HTTP 200 even when Groq is rate-limited or
     * down, so the frontend never breaks. Only the
     * per-user generation limit answers 429.
     */
    if (
      typeof body.message === "string" &&
      body.message.trim()
    ) {
      // Every chat message is a new generation, so each one is counted (per user).
      const admission = await admitGeneration(supabase, "chat")

      if (!admission.allowed && admission.reason === "rate_limited") {
        return rateLimitedResponse(admission.retryAfterSeconds, {
          ok: false,
          ai: false,
        })
      }

      let reason = "unavailable"

      try {
        // Nothing is sent to Groq unless the request was admitted.
        const chat = !admission.allowed
          ? null
          : await groqChatOutcome(
            [
              {
                role: "system",
                content: `You are SkillBridge AI Career Assistant.

Help the user with:
- career guidance
- skill recommendations
- learning roadmaps
- skill gap analysis
- jobs
- interview preparation
- project guidance

${profileContext}

Rules:
- Answer the user's exact question.
- Be practical and useful.
- Use the user's role and skills when relevant.
- Do not invent personal information.
- Do not claim actions were performed if they were not.
- Keep the answer clear and concise.`,
              },
              {
                role: "user",
                content:
                  body.message.trim(),
              },
            ],
            {
              temperature: 0.3,
              maxTokens: 1200,
            }
          )

        if (chat?.ok) {
          return NextResponse.json({
            ok: true,
            ai: true,
            fallback: false,
            reply: chat.result.text.trim(),
            model: chat.result.model,
          })
        }

        if (chat) {
          reason = chat.reason
        }
      } catch (error) {
        console.error(
          "Chat AI error:",
          error instanceof Error ? error.message : "unknown error"
        )
      }

      /*
       * Groq unavailable / 429 / quota exhausted.
       * Never return an error to the frontend.
       */
      const opening =
        reason === "rate_limited"
          ? "SkillBridge AI is busy right now because the AI usage limit was reached. Please try again in a minute."
          : "I'm currently running in SkillBridge fallback mode."

      const guidance = profile
        ? `Your target role is ${role}.
Your current skills: ${
            skills.join(", ") ||
            "none added yet"
          }.
Your experience level: ${experience}.

For your career path, focus on the core skills required for your target role, then strengthen practical projects, problem solving, Git/GitHub, and interview preparation.

Your saved SkillBridge profile and roadmap are still available. AI responses will resume automatically when the Groq service is available again.`
        : "Finish your profile setup so SkillBridge can tailor its advice to your target role."

      return NextResponse.json({
        ok: true,
        ai: false,
        fallback: true,
        reason,
        reply: `${opening}\n\n${guidance}`,
        model: null,
      })
    }

    /*
     * CAREER ANALYSIS MODE needs a saved profile to analyze.
     */
    if (!profile) {
      return NextResponse.json(
        {
          ok: false,
          ai: false,
          error: "Profile setup required",
        },
        { status: 409 }
      )
    }

    /*
     * CAREER ANALYSIS MODE
     */
    const prompt = `
Analyze this SkillBridge candidate.

TARGET ROLE:
${role}

CURRENT SKILLS:
${skills.join(", ") || "None"}

EXPERIENCE:
${experience}

CURRENT JOB MARKET DATA:
${JSON.stringify(jobs)}

Return JSON with exactly:
{
  "summary": "short practical summary",
  "readiness": 0,
  "strengths": ["skill"],
  "gaps": ["skill"],
  "prioritySkills": ["skill"],
  "roadmap": [
    {
      "skill": "skill",
      "priority": "high",
      "reason": "why this matters"
    }
  ],
  "jobFit": "short explanation"
}

Rules:
- readiness must be 0-100
- do not invent skills the candidate has
- distinguish current skills from missing skills
- prioritize relevant skills
- roadmap should contain 3-8 items
- do not recommend unrelated technologies
`

    const estimate: Analysis = {
      ...fallback,
      summary:
        skills.length > 0
          ? `Your profile targets ${role} with ${skills.length} recorded skills.`
          : fallback.summary,
      readiness: skills.length
        ? Math.min(
            90,
            skills.length * 8
          )
        : 0,
      strengths:
        skills.slice(0, 5),
      gaps: [],
      prioritySkills: [],
      roadmap: [],
    }

    // Analysis mode is also an /api/ai generation, so it uses the same "chat" allowance.
    const admission = await admitGeneration(supabase, "chat")

    if (!admission.allowed && admission.reason === "rate_limited") {
      return rateLimitedResponse(admission.retryAfterSeconds, {
        ok: false,
        ai: false,
      })
    }

    const outcome = admission.allowed
      ? await groqJSONOutcome(
          "You are SkillBridge's career intelligence engine. Be accurate, practical and conservative.",
          prompt
        )
      : ({ ok: false, reason: "unavailable" } as const)

    // Without a parsed AI object the estimate is returned, clearly marked as not AI.
    if (!outcome.ok || !isPlainObject(outcome.data)) {
      return NextResponse.json({
        ok: true,
        ai: false,
        fallback: true,
        reason: outcome.ok ? "invalid_output" : outcome.reason,
        model: null,
        targetRole: role,
        analysis: estimate,
      })
    }

    const analysis = outcome.data as Partial<Analysis>

    const normalized: Analysis = {
      summary:
        typeof analysis?.summary ===
        "string"
          ? analysis.summary
          : fallback.summary,

      readiness:
        normalizeNumber(
          analysis?.readiness
        ),

      strengths:
        normalizeStringArray(
          analysis?.strengths
        ),

      gaps:
        normalizeStringArray(
          analysis?.gaps
        ),

      prioritySkills:
        normalizeStringArray(
          analysis?.prioritySkills
        ),

      roadmap:
        Array.isArray(
          analysis?.roadmap
        )
          ? analysis.roadmap
              .map((item): Analysis["roadmap"][number] => ({
                skill: String(
                  item?.skill || ""
                ).trim(),

                priority:
                  item?.priority === "high" ||
                  item?.priority === "low"
                    ? item.priority
                    : "medium",

                reason: String(
                  item?.reason || ""
                ).trim(),
              }))
              .filter(
                (item) => item.skill
              )
              .slice(0, 10)
          : [],

      jobFit:
        typeof analysis?.jobFit ===
        "string"
          ? analysis.jobFit
          : fallback.jobFit,
    }

    return NextResponse.json({
      ok: true,
      ai: true,
      fallback: false,
      model: outcome.model,
      targetRole: role,
      analysis: normalized,
    })
  } catch (error) {
    console.error(
      "SkillBridge AI route error:",
      error instanceof Error ? error.message : "unknown error"
    )

    /*
     * Even unexpected server errors return a usable
     * response instead of breaking the frontend.
     */
    return NextResponse.json({
      ok: true,
      ai: false,
      fallback: true,
      reply:
        "SkillBridge AI is temporarily using fallback mode. Your profile, assessment and roadmap remain available.",
      analysis: fallback,
    })
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service:
      "SkillBridge Groq AI",
    model:
      "openai/gpt-oss-20b",
  })
}
