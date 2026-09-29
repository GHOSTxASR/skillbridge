import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { dbErrorResponse, jsonError, readJsonBody } from "@/lib/skills/http"
import { EVIDENCE_COLUMNS, toEvidence } from "@/lib/skills/rows"
import {
  isUuid,
  parseEvidenceMetadata,
  parseEvidenceUpdate,
  type UserEvidenceType,
} from "@/lib/skills/validation"

// PATCH { title?, description?, sourceUrl?, metadata? } edits the signed-in user's own
// project or learning evidence; PATCH { retracted: true } withdraws it. Evidence is never
// deleted: a retracted record stays in the history and a future confidence model ignores
// it. Assessment evidence can be neither edited nor retracted. Another user's evidence id
// gets the same 404 as an id that does not exist.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return jsonError(401, "Authentication required")

    const { id } = await params
    if (!isUuid(id)) return jsonError(404, "evidence not found")
    const evidenceId = id.toLowerCase()

    const read = await readJsonBody(request)
    if (!read.ok) return read.response

    const parsed = parseEvidenceUpdate(read.body)
    if (!parsed.ok) return jsonError(parsed.status, parsed.error)
    const update = parsed.value

    if (update.action === "retract") {
      const { data, error } = await supabase.rpc("retract_skill_evidence", { p_evidence_id: evidenceId })
      if (error) return dbErrorResponse(error, "Skill evidence retract")
      return NextResponse.json({ evidence: toEvidence(data as Record<string, unknown>) })
    }

    // Unchanged fields keep their stored values, so an edit never clears what it did
    // not mention.
    const { data: stored, error: readError } = await supabase
      .from("skill_evidence")
      .select(EVIDENCE_COLUMNS)
      .eq("id", evidenceId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (readError) return dbErrorResponse(readError, "Skill evidence read")
    if (!stored) return jsonError(404, "evidence not found")
    const current = stored as unknown as Record<string, unknown>

    const type = current.evidence_type as string
    if (type !== "project" && type !== "learning") {
      return jsonError(403, "assessment evidence cannot be edited")
    }

    let metadata = current.metadata as Record<string, unknown>
    if (update.metadata !== undefined) {
      const checked = parseEvidenceMetadata(type as UserEvidenceType, update.metadata)
      if (!checked.ok) return jsonError(checked.status, checked.error)
      metadata = checked.value
    }

    const { data, error } = await supabase.rpc("update_skill_evidence", {
      p_evidence_id: evidenceId,
      p_title: update.title ?? current.title,
      p_description: update.description !== undefined ? update.description : current.description,
      p_source_url: update.sourceUrl !== undefined ? update.sourceUrl : current.source_url,
      p_metadata: metadata,
    })
    if (error) return dbErrorResponse(error, "Skill evidence update")

    return NextResponse.json({ evidence: toEvidence(data as Record<string, unknown>) })
  } catch (error) {
    console.error("Skill evidence update failed:", error instanceof Error ? error.name : "unknown")
    return jsonError(500, "Something went wrong. Please try again.")
  }
}
