import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { dbErrorResponse, jsonError, readJsonBody } from "@/lib/skills/http"
import { EVIDENCE_COLUMNS, toEvidence } from "@/lib/skills/rows"
import { isUuid, parseEvidenceCreate } from "@/lib/skills/validation"

const MAX_ROWS = 200

// GET ?skillId=<uuid>&includeRetracted=1: the signed-in user's evidence, newest first.
export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return jsonError(401, "Authentication required")

    const params = new URL(request.url).searchParams
    const skillId = params.get("skillId")
    if (skillId !== null && !isUuid(skillId)) return jsonError(400, "skillId must be a skill id")

    let query = supabase
      .from("skill_evidence")
      .select(`${EVIDENCE_COLUMNS}, skills(name, category)`)
      .eq("user_id", user.id)
      .order("observed_at", { ascending: false })
      .limit(MAX_ROWS)
    if (skillId) query = query.eq("skill_id", skillId.toLowerCase())
    if (params.get("includeRetracted") !== "1") query = query.is("retracted_at", null)

    const { data, error } = await query
    if (error) return dbErrorResponse(error, "Skill evidence read")

    return NextResponse.json({
      evidence: (data ?? []).map((row) => toEvidence(row as Record<string, unknown>)),
    })
  } catch (error) {
    console.error("Skill evidence read failed:", error instanceof Error ? error.name : "unknown")
    return jsonError(500, "Something went wrong. Please try again.")
  }
}

// POST { type: "project" | "learning", skillIds, title, description?, sourceUrl?,
// metadata?, observedAt? }: records evidence for the signed-in user, one row per skill.
// The owner is always the session's user; assessment evidence and scores cannot be
// submitted.
export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return jsonError(401, "Authentication required")

    const read = await readJsonBody(request)
    if (!read.ok) return read.response

    const parsed = parseEvidenceCreate(read.body)
    if (!parsed.ok) return jsonError(parsed.status, parsed.error)
    const input = parsed.value

    const { data, error } = await supabase.rpc("add_skill_evidence", {
      p_skill_ids: input.skillIds,
      p_evidence_type: input.type,
      p_title: input.title,
      p_description: input.description,
      p_source_url: input.sourceUrl,
      p_metadata: input.metadata,
      p_observed_at: input.observedAt,
    })
    if (error) return dbErrorResponse(error, "Skill evidence create")

    const result = (data ?? {}) as { group_id?: unknown; evidence?: unknown }
    return NextResponse.json(
      {
        groupId: typeof result.group_id === "string" ? result.group_id : null,
        evidence: Array.isArray(result.evidence)
          ? result.evidence.map((row) => toEvidence(row as Record<string, unknown>))
          : [],
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Skill evidence create failed:", error instanceof Error ? error.name : "unknown")
    return jsonError(500, "Something went wrong. Please try again.")
  }
}
