import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { normalizeSkills } from "@/lib/ai/profile-input"
import { loadSkillCatalog, resolveSkills } from "@/lib/skills/catalog"
import { dbErrorResponse, jsonError, readJsonBody } from "@/lib/skills/http"
import { PROGRESS_COLUMNS, toClaim, toProgress } from "@/lib/skills/rows"
import { isUuid, parseProgressUpdate } from "@/lib/skills/validation"

const MAX_ROWS = 500

// GET: the signed-in user's progress per skill, plus the skills they claim on their
// profile resolved to canonical catalog skills (lib/skills/catalog.ts). Claims and
// progress are reported separately: a claim is "the user says so", never evidence or
// confidence. A claim the catalog cannot resolve is still listed, with skillId null.
//
// GET ?skillId=<uuid>: the same for one catalog skill, plus that skill's catalog record
// ({ skill, progress, claims }). 404 when the catalog has no such skill. The id only picks
// the skill; the rows are always the session user's own.
export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return jsonError(401, "Authentication required")

    const param = new URL(request.url).searchParams.get("skillId")
    if (param !== null && !isUuid(param)) return jsonError(400, "skillId must be a skill id")
    const skillId = param?.toLowerCase() ?? null

    let progressQuery = supabase
      .from("skill_progress")
      .select(`${PROGRESS_COLUMNS}, skills(name, category)`)
      .eq("user_id", user.id)
    if (skillId) progressQuery = progressQuery.eq("skill_id", skillId)

    const [progressResult, profileResult, catalog] = await Promise.all([
      progressQuery.order("last_activity_at", { ascending: false }).limit(MAX_ROWS),
      supabase.from("profiles").select("skills").eq("id", user.id).maybeSingle(),
      loadSkillCatalog(supabase),
    ])

    if (progressResult.error || profileResult.error) {
      return dbErrorResponse(progressResult.error ?? profileResult.error, "Skill progress read")
    }
    if (!catalog) return jsonError(503, "The skill catalog is unavailable. Please try again.")

    const skill = skillId ? catalog.skills.find((entry) => entry.id === skillId) : null
    if (skillId && !skill) return jsonError(404, "Skill not found")

    const claims = resolveSkills(catalog, normalizeSkills(profileResult.data?.skills)).map(toClaim)
    const claimedIds = new Set(claims.map((claim) => claim.skillId).filter(Boolean))
    const progress = (progressResult.data ?? []).map((row) =>
      toProgress(row as Record<string, unknown>, claimedIds.has(row.skill_id as string))
    )

    if (skill) {
      return NextResponse.json({
        skill: { id: skill.id, name: skill.name, category: skill.category },
        progress,
        claims: claims.filter((claim) => claim.skillId === skill.id),
      })
    }

    return NextResponse.json({ progress, claims })
  } catch (error) {
    console.error("Skill progress read failed:", error instanceof Error ? error.name : "unknown")
    return jsonError(500, "Something went wrong. Please try again.")
  }
}

// PATCH { skillId, status }: the user says they are learning / practicing a skill (or
// not started). assessed and proven come only from evidence.
export async function PATCH(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return jsonError(401, "Authentication required")

    const read = await readJsonBody(request)
    if (!read.ok) return read.response

    const parsed = parseProgressUpdate(read.body)
    if (!parsed.ok) return jsonError(parsed.status, parsed.error)

    const { data, error } = await supabase.rpc("set_skill_progress_status", {
      p_skill_id: parsed.value.skillId,
      p_status: parsed.value.status,
    })
    if (error) return dbErrorResponse(error, "Skill progress update")

    return NextResponse.json({ progress: toProgress(data as Record<string, unknown>) })
  } catch (error) {
    console.error("Skill progress update failed:", error instanceof Error ? error.name : "unknown")
    return jsonError(500, "Something went wrong. Please try again.")
  }
}
