import { NextResponse } from "next/server"
import {
  groqJSON,
  groqChat,
} from "@/lib/ai/groq"
import { createSupabaseServerClient } from "@/lib/supabase-server"

export const dynamic = "force-dynamic"

type AnalysisInput = {
  role?: string
  skills?: string[]
  experience?: string
  message?: string
  jobs?: Array<{
    title?: string
    description?: string
    matchedSkills?: string[]
  }>
  assessment?: Record<string, unknown>
}

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
      })
    }

    const body =
      (await request.json().catch(() => ({}))) as AnalysisInput

    const { data: profile } =
      await supabase
        .from("profiles")
        .select(
          "target_role, skills, experience_level"
        )
        .eq("id", user.id)
        .maybeSingle()

    const role =
      body.role?.trim() ||
      String(
        profile?.target_role || ""
      ).trim() ||
      "Software Engineer"

    const rawSkills =
      body.skills ||
      (Array.isArray(profile?.skills)
        ? profile.skills.map(String)
        : typeof profile?.skills === "string"
          ? profile.skills.split(",")
          : [])

    const skills = Array.from(
      new Set(
        rawSkills
          .map((skill) =>
            String(skill).trim()
          )
          .filter(Boolean)
      )
    ).slice(0, 30)

    const experience =
      body.experience ||
      String(
        profile?.experience_level ||
          "Not specified"
      )

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
     * Always returns HTTP 200 so the frontend never
     * breaks when Groq is temporarily rate-limited.
     */
    if (
      typeof body.message === "string" &&
      body.message.trim()
    ) {
      try {
        const chat =
          await groqChat(
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

User target role:
${role}

User current skills:
${skills.join(", ") || "None provided"}

User experience:
${experience}

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

        if (
          chat &&
          typeof chat.text === "string" &&
          chat.text.trim()
        ) {
          return NextResponse.json({
            ok: true,
            ai: true,
            fallback: false,
            reply: chat.text.trim(),
            model: chat.model,
          })
        }
      } catch (error) {
        console.error(
          "Chat AI error:",
          error
        )
      }

      /*
       * Groq unavailable / 429 / quota exhausted.
       * Never return an error to the frontend.
       */
      const fallbackReply =
        `I'm currently running in SkillBridge fallback mode.

Your target role is ${role}.
Your current skills: ${
          skills.join(", ") ||
          "none added yet"
        }.
Your experience level: ${experience}.

For your career path, focus on the core skills required for your target role, then strengthen practical projects, problem solving, Git/GitHub, and interview preparation.

Your saved SkillBridge profile and roadmap are still available. AI responses will resume automatically when the Groq service is available again.`

      return NextResponse.json({
        ok: true,
        ai: false,
        fallback: true,
        reply: fallbackReply,
        model: null,
      })
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

    const analysis =
      await groqJSON<Analysis>(
        "You are SkillBridge's career intelligence engine. Be accurate, practical and conservative.",
        prompt,
        {
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
      )

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
      model:
        "openai/gpt-oss-20b",
      analysis: normalized,
    })
  } catch (error) {
    console.error(
      "SkillBridge AI route error:",
      error
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
