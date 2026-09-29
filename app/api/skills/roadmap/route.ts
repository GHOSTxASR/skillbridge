import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { loadSkillCatalog } from "@/lib/skills/catalog"
import { jsonError, readJsonBody } from "@/lib/skills/http"
import { parseRoadmapCompletion } from "@/lib/skills/roadmap"

// The bridge from the learning roadmap to skill evidence, built only on the user's trusted,
// immutable roadmap versions (public.learning_roadmap_versions / _steps, written by the
// server when a roadmap is generated). The display cache, public.learning_roadmaps, is never
// read here. Neither method generates a roadmap or calls AI; both use the user's session.
//
// GET  -> { available: false }  or  { available: true, versionId, generatedAt, steps: [{ order,
//         skill, skillId, skillName, completed }] } for the user's latest version.
// POST { versionId, stepOrder } -> complete_roadmap_learning_step(), which derives the skill,
//         title and description from the version, only accepts the latest version, and is
//         idempotent.

const MAX_EVIDENCE_ROWS = 200

type VersionRow = { id: string; generated_at: string; step_count: number }
type StepRow = { step_order: number; skill_text: string; skill_id: string | null }

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return jsonError(401, "Authentication required")

    const { data: version, error: versionError } = await supabase
      .from("learning_roadmap_versions")
      .select("id, generated_at, step_count")
      .eq("user_id", user.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle<VersionRow>()
    if (versionError) {
      console.error("Roadmap version read failed:", versionError.code ?? "unknown")
      return jsonError(500, "Something went wrong. Please try again.")
    }
    if (!version) return NextResponse.json({ available: false })

    const [stepsResult, evidenceResult, catalog] = await Promise.all([
      supabase
        .from("learning_roadmap_version_steps")
        .select("step_order, skill_text, skill_id")
        .eq("version_id", version.id)
        .order("step_order", { ascending: true })
        .limit(50),
      supabase
        .from("skill_evidence")
        .select("skill_id, metadata")
        .eq("user_id", user.id)
        .eq("evidence_type", "learning")
        .is("retracted_at", null)
        .eq("metadata->>source", "roadmap")
        .eq("metadata->>roadmap_version_id", version.id)
        .limit(MAX_EVIDENCE_ROWS),
      loadSkillCatalog(supabase),
    ])
    if (stepsResult.error || evidenceResult.error) {
      console.error("Roadmap version read failed:", (stepsResult.error ?? evidenceResult.error)?.code ?? "unknown")
      return jsonError(500, "Something went wrong. Please try again.")
    }
    if (!catalog) return jsonError(503, "The skill catalog is unavailable. Please try again.")

    const steps = (stepsResult.data ?? []) as StepRow[]
    if (steps.length !== version.step_count) {
      console.error("Roadmap version read failed: incomplete version")
      return NextResponse.json({ available: false })
    }

    const names = new Map(catalog.skills.map((skill) => [skill.id, skill.name]))
    const done = new Set(
      (evidenceResult.data ?? []).map(
        (item) => `${item.skill_id}:${(item.metadata as Record<string, unknown> | null)?.roadmap_step}`
      )
    )

    return NextResponse.json({
      available: true,
      versionId: version.id,
      generatedAt: version.generated_at,
      steps: steps.map((step) => ({
        order: step.step_order,
        skill: step.skill_text,
        skillId: step.skill_id,
        skillName: step.skill_id ? names.get(step.skill_id) ?? null : null,
        completed: step.skill_id ? done.has(`${step.skill_id}:${step.step_order}`) : false,
      })),
    })
  } catch (error) {
    console.error("Roadmap version read failed:", error instanceof Error ? error.name : "unknown")
    return jsonError(500, "Something went wrong. Please try again.")
  }
}

const FAILED = "This roadmap step couldn't be recorded. Please try again."

function failure(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status })
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return jsonError(401, "Authentication required")

    const read = await readJsonBody(request)
    if (!read.ok) return read.response
    const parsed = parseRoadmapCompletion(read.body)
    if (!parsed.ok) return jsonError(400, parsed.error)

    const { data, error } = await supabase.rpc("complete_roadmap_learning_step", {
      p_version_id: parsed.value.versionId,
      p_step_order: parsed.value.stepOrder,
    })
    if (error) {
      switch (error.code) {
        case "P0002":
          return failure(404, "That roadmap step isn't available.", "not_found")
        case "SB409":
          return failure(409, "Your roadmap has changed. Reload it to see the current steps.", "stale_roadmap")
        case "SB422":
          return failure(422, "This roadmap step uses a skill that SkillBridge couldn't match yet.", "unmatched_skill")
        case "54000":
          return failure(409, "You've reached the limit of 1000 evidence records.", "evidence_limit")
        case "42501":
          return failure(403, "Not allowed.", "not_allowed")
        case "22023":
          return failure(400, "That roadmap step couldn't be recorded.", "invalid")
        default:
          console.error("Roadmap step completion failed:", error.code ?? "unknown")
          return failure(500, FAILED, "error")
      }
    }

    const result = (data ?? {}) as { created?: unknown; evidence?: Record<string, unknown>; progress?: Record<string, unknown> | null }
    const created = result.created === true
    const metadata = (result.evidence?.metadata ?? {}) as Record<string, unknown>
    return NextResponse.json(
      {
        ok: true,
        created,
        alreadyCompleted: !created,
        step: {
          order: typeof metadata.roadmap_step === "number" ? metadata.roadmap_step : parsed.value.stepOrder,
          skillId: typeof result.evidence?.skill_id === "string" ? result.evidence.skill_id : null,
          skillName: typeof metadata.skill_name === "string" ? metadata.skill_name : null,
        },
        evidence: {
          type: "learning",
          title: typeof result.evidence?.title === "string" ? result.evidence.title : null,
          observedAt: typeof result.evidence?.observed_at === "string" ? result.evidence.observed_at : null,
        },
        progress: { status: typeof result.progress?.status === "string" ? result.progress.status : null },
      },
      { status: created ? 201 : 200 }
    )
  } catch (error) {
    console.error("Roadmap step completion failed:", error instanceof Error ? error.name : "unknown")
    return failure(500, FAILED, "error")
  }
}
