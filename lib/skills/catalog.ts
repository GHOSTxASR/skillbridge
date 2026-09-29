import type { createSupabaseServerClient } from "@/lib/supabase-server"

// One way to turn a skill name into a canonical catalog skill, for every server route.
//
//   raw name -> key -> canonical skill (public.skills) -> skill id
//
// The catalog and its aliases live only in the database (public.skills,
// public.skill_aliases); this file holds no skill list of its own. Every name is first turned
// into a key (case, spacing and hyphen look-alikes normalised, see skillKey), the same way
// for the input, the catalog names and the alias keys. Resolution is then exact and explicit,
// in this order:
//   1. the key equals a canonical skill name                 ("react"        -> React)
//   2. the key equals an explicit alias                      ("react.js"     -> React)
//   3. one level word removed, then 1-2 again                ("sql advanced" -> SQL,
//                                                              "javascript basics" -> JavaScript)
// There is no substring, prefix or similarity matching, so "Java" never matches
// "JavaScript", "SQL" never matches "MySQL" or "PostgreSQL", and an unknown name stays
// unresolved (it is reported, never dropped or renamed to something else).

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export type CatalogSkill = { id: string; name: string; category: string | null }

export type SkillMatch = "name" | "alias" | "level"

export type SkillResolution =
  | { input: string; skill: CatalogSkill; matchedBy: SkillMatch }
  | { input: string; skill: null; matchedBy: null; reason: "empty" | "unknown" }

export type SkillCatalog = {
  skills: CatalogSkill[]
  byName: Map<string, CatalogSkill>
  byAlias: Map<string, CatalogSkill>
}

const MAX_INPUT = 80

// Hyphen and dash look-alikes that AI output and pasted text use in place of "-" (the live
// audit found "Object‑Oriented Design" written with U+2011). They mean the same character in
// a skill name, so they are folded to the ASCII hyphen. Only these code points; no other
// punctuation is touched.
//   U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash, U+2013 en dash,
//   U+2014 em dash, U+2212 minus sign
const HYPHEN_LOOKALIKES = /[‐‑‒–—−]/g

// The comparison key. Same rule as public.skill_aliases.alias_key (see the migration),
// lower(btrim(regexp_replace(x, '\s+', ' ', 'g'))), plus hyphen folding. The database stores
// keys with ASCII hyphens only, so folding them changes nothing; it is applied to catalog
// names, alias keys and input alike so both sides of every comparison match.
export function skillKey(raw: unknown): string {
  if (typeof raw !== "string") return ""
  return raw.replace(HYPHEN_LOOKALIKES, "-").trim().replace(/\s+/g, " ").toLowerCase()
}

// Words that describe how deep a step goes, not which skill it is. Only one prefix and one
// suffix are removed, and the remainder must still match a name or alias exactly.
const LEVEL_PREFIXES = ["advanced ", "intermediate ", "basic ", "introduction to ", "intro to ", "fundamentals of "]
const LEVEL_SUFFIXES = [" basics", " fundamentals", " essentials", " advanced", " framework"]

function withoutLevelWords(key: string): string[] {
  const candidates: string[] = []
  const prefix = LEVEL_PREFIXES.find((p) => key.startsWith(p) && key.length > p.length)
  const afterPrefix = prefix ? key.slice(prefix.length).trim() : key
  if (prefix) candidates.push(afterPrefix)
  const suffix = LEVEL_SUFFIXES.find((s) => afterPrefix.endsWith(s) && afterPrefix.length > s.length)
  if (suffix) candidates.push(afterPrefix.slice(0, -suffix.length).trim())
  return candidates.filter(Boolean)
}

export function buildCatalog(
  skills: Array<{ id: unknown; name: unknown; category?: unknown }>,
  aliases: Array<{ alias_key: unknown; skill_id: unknown }>
): SkillCatalog {
  const list: CatalogSkill[] = []
  const byId = new Map<string, CatalogSkill>()
  const byName = new Map<string, CatalogSkill>()

  for (const row of skills) {
    if (typeof row.id !== "string" || typeof row.name !== "string") continue
    const skill = { id: row.id, name: row.name.trim(), category: typeof row.category === "string" ? row.category : null }
    const key = skillKey(skill.name)
    // The database keeps names unique ignoring case; if that ever fails, the first wins.
    if (!key || byName.has(key)) continue
    list.push(skill)
    byId.set(skill.id, skill)
    byName.set(key, skill)
  }

  const byAlias = new Map<string, CatalogSkill>()
  for (const row of aliases) {
    if (typeof row.alias_key !== "string" || typeof row.skill_id !== "string") continue
    const skill = byId.get(row.skill_id)
    // Re-keyed with the same rule as names and input; a stored key is already normalised.
    const key = skillKey(row.alias_key)
    // A canonical name always wins over an alias with the same key.
    if (skill && key && !byName.has(key)) byAlias.set(key, skill)
  }

  return { skills: list, byName, byAlias }
}

function exact(catalog: SkillCatalog, key: string): { skill: CatalogSkill; matchedBy: "name" | "alias" } | null {
  const byName = catalog.byName.get(key)
  if (byName) return { skill: byName, matchedBy: "name" }
  const byAlias = catalog.byAlias.get(key)
  if (byAlias) return { skill: byAlias, matchedBy: "alias" }
  return null
}

export function resolveSkill(catalog: SkillCatalog, raw: unknown): SkillResolution {
  const input = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").slice(0, MAX_INPUT) : ""
  const key = skillKey(input)
  if (!key) return { input, skill: null, matchedBy: null, reason: "empty" }

  const direct = exact(catalog, key)
  if (direct) return { input, ...direct }

  for (const candidate of withoutLevelWords(key)) {
    const found = exact(catalog, candidate)
    if (found) return { input, skill: found.skill, matchedBy: "level" }
  }

  return { input, skill: null, matchedBy: null, reason: "unknown" }
}

// Resolves a list, keeping every input (resolved or not) in order.
export function resolveSkills(catalog: SkillCatalog, raws: unknown[]): SkillResolution[] {
  return raws.map((raw) => resolveSkill(catalog, raw))
}

// The catalog changes only through migrations, so each server process keeps it for a few
// minutes instead of reading it on every request. Failed reads are not cached.
const CACHE_MS = 5 * 60 * 1000
const MAX_ROWS = 5000
let cached: { at: number; catalog: SkillCatalog } | null = null

export async function loadSkillCatalog(supabase: ServerClient): Promise<SkillCatalog | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.catalog

  const [skills, aliases] = await Promise.all([
    supabase.from("skills").select("id, name, category").limit(MAX_ROWS),
    supabase.from("skill_aliases").select("alias_key, skill_id").limit(MAX_ROWS),
  ])
  if (skills.error || aliases.error) {
    console.error("Skill catalog read failed:", skills.error?.code ?? aliases.error?.code ?? "unknown")
    return null
  }

  const catalog = buildCatalog(skills.data ?? [], aliases.data ?? [])
  cached = { at: Date.now(), catalog }
  return catalog
}
