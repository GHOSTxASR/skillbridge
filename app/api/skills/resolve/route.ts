import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { loadSkillCatalog, resolveSkills } from "@/lib/skills/catalog"
import { jsonError, readJsonBody } from "@/lib/skills/http"
import { isPlainObject } from "@/lib/skills/validation"

const MAX_NAMES = 50
const MAX_NAME_LENGTH = 200

// POST { names: string[] }: maps skill names (from the profile, a gap analysis or a
// roadmap step) to canonical catalog skills. It reads only the public catalog, never
// anyone's progress or evidence. Every name comes back, in order; names the catalog does
// not know have skill null and reason "unknown", so nothing is dropped or renamed.
export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return jsonError(401, "Authentication required")

    const read = await readJsonBody(request)
    if (!read.ok) return read.response

    const body = read.body
    if (!isPlainObject(body) || Object.keys(body).some((key) => key !== "names")) {
      return jsonError(400, 'send { "names": [ ... ] }')
    }
    const names = body.names
    if (
      !Array.isArray(names) ||
      names.length < 1 ||
      names.length > MAX_NAMES ||
      !names.every((name) => typeof name === "string" && name.length <= MAX_NAME_LENGTH)
    ) {
      return jsonError(400, `names must be 1 to ${MAX_NAMES} skill names of at most ${MAX_NAME_LENGTH} characters`)
    }

    const catalog = await loadSkillCatalog(supabase)
    if (!catalog) return jsonError(503, "The skill catalog is unavailable. Please try again.")

    return NextResponse.json({ results: resolveSkills(catalog, names) })
  } catch (error) {
    console.error("Skill resolve failed:", error instanceof Error ? error.name : "unknown")
    return jsonError(500, "Something went wrong. Please try again.")
  }
}
