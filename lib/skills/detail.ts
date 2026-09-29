import { isEvidenceUrl, isUuid } from "@/lib/skills/validation"
import {
  EVIDENCE_LABEL,
  progressStatus,
  sortEvidenceCounts,
  type ClaimItem,
  type EvidenceCount,
  type EvidenceItem,
  type ProgressItem,
  type ProgressStatus,
} from "@/lib/skills/view"

// One skill's detail page, built only from what the API returns:
//
//   GET /api/skills/progress?skillId=<id> -> { skill, progress, claims }  (404: no such skill)
//   GET /api/skills/evidence?skillId=<id> -> { evidence }                 (retracted excluded)
//
// The catalog record (name, category) comes from the server. Claim, progress, evidence and
// assessment stay separate facts; nothing here scores, ranks or upgrades anything.

export const isSkillId = (value: unknown): value is string => isUuid(value)

export type CatalogSkill = { id: string; name: string; category: string | null }

export type SkillDetailResponse = { skill: CatalogSkill; progress: ProgressItem[]; claims: ClaimItem[] }

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null)

export function readSkillDetailResponse(body: unknown): SkillDetailResponse | null {
  if (!body || typeof body !== "object") return null
  const { skill, progress, claims } = body as Record<string, unknown>
  if (!skill || typeof skill !== "object" || !Array.isArray(progress) || !Array.isArray(claims)) return null
  const record = skill as Record<string, unknown>
  const id = text(record.id)
  const name = text(record.name)
  if (!id || !name) return null
  return {
    skill: { id, name, category: text(record.category) },
    progress: progress as ProgressItem[],
    claims: claims as ClaimItem[],
  }
}

// --- The skill itself -----------------------------------------------------------------------

// The skill's catalog record (public.skills, readable by everyone), loaded on its own so the
// page can always name the skill whatever happens to the user's progress or evidence.
export type CatalogLoad = { state: "loading" } | { state: "ready"; skill: CatalogSkill | null } | { state: "error" }

export function readCatalogSkill(row: unknown): CatalogSkill | null {
  if (!row || typeof row !== "object") return null
  const record = row as Record<string, unknown>
  const id = text(record.id)
  const name = text(record.name)
  return id && name ? { id, name, category: text(record.category) } : null
}

export type SkillHeading =
  | { kind: "not-found" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; skill: CatalogSkill }

// The name and category come only from the catalog record, never from the user's progress.
// An id the catalog does not have is "not found"; a catalog read that failed is an error the
// user can retry, unless the server has already answered 404/400 for the id.
export function skillHeading(valid: boolean, catalog: CatalogLoad, progressErrorStatus: number | null): SkillHeading {
  if (!valid) return { kind: "not-found" }
  if (catalog.state === "ready") return catalog.skill ? { kind: "ready", skill: catalog.skill } : { kind: "not-found" }
  if (catalog.state === "loading") return { kind: "loading" }
  return progressErrorStatus === 404 || progressErrorStatus === 400 ? { kind: "not-found" } : { kind: "error" }
}

// --- Claim and progress -----------------------------------------------------------------

export type ProfileSpelling = { text: string; mapped: boolean }

export type SkillDetail = {
  skill: CatalogSkill
  // On the user's profile. Self-reported, never verified.
  claimed: boolean
  // How the skill is written on the profile. mapped: the server matched it by alias or by
  // removing a level word ("React.js", "SQL Advanced"), not by the skill's own name.
  spellings: ProfileSpelling[]
  progress: {
    status: ProgressStatus | null
    // Only values the backend actually stored (0-100); never derived from evidence.
    learningProgress: number | null
    practiceProgress: number | null
    firstObservedAt: string | null
    lastActivityAt: string | null
    lastAssessedAt: string | null
  } | null
}

const percent = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null

export function buildSkillDetail(response: SkillDetailResponse): SkillDetail {
  const { skill } = response
  const spellings: ProfileSpelling[] = []
  for (const claim of response.claims) {
    const spelling = text(claim?.name)
    if (claim?.skillId !== skill.id || !spelling) continue
    if (spellings.some((known) => known.text.toLowerCase() === spelling.toLowerCase())) continue
    spellings.push({ text: spelling, mapped: claim.matchedBy === "alias" || claim.matchedBy === "level" })
  }

  const row = response.progress.find((item) => item?.skillId === skill.id)
  return {
    skill,
    claimed: spellings.length > 0,
    spellings,
    progress: row
      ? {
          status: progressStatus(row.status),
          learningProgress: percent(row.learningProgress),
          practiceProgress: percent(row.practiceProgress),
          firstObservedAt: text(row.firstObservedAt),
          lastActivityAt: text(row.lastActivityAt),
          lastAssessedAt: text(row.lastAssessedAt),
        }
      : null,
  }
}

// --- Evidence -----------------------------------------------------------------------------

export type SafeLink = { href: string; host: string }

// Evidence links are user-supplied. Only https links that pass the same rule the API and
// database enforce are ever rendered; nothing is fetched or embedded.
export function safeLink(value: unknown): SafeLink | null {
  if (!isEvidenceUrl(value)) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? { href: url.href, host: url.hostname } : null
  } catch {
    return null
  }
}

export type EvidenceEntry = {
  // For list keys only; never rendered.
  key: string
  type: string
  label: string
  title: string
  description: string | null
  observedAt: string | null
  // Assessment evidence only: the score SkillBridge recorded (0-100).
  score: number | null
  source: SafeLink | null
  // The item has a link that is not rendered (not https, or not a valid link).
  sourceHidden: boolean
  demo: SafeLink | null
  // Learning activity recorded against a roadmap step.
  roadmapStep: number | null
}

const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0)

// The user's own, non-retracted evidence for this skill, newest first.
export function buildEvidenceEntries(items: EvidenceItem[], skillId: string): EvidenceEntry[] {
  return items
    .filter((item) => item && item.skillId === skillId && item.retracted !== true && text(item.type))
    .map((item, index) => {
      const type = text(item.type)!
      const metadata = (item.metadata ?? {}) as Record<string, unknown>
      const rawSource = text(item.sourceUrl)
      const source = safeLink(rawSource)
      const step = metadata.roadmap_step
      return {
        key: text(item.id) ?? `evidence-${index}`,
        type,
        label: EVIDENCE_LABEL[type] ?? "Evidence",
        title: text(item.title) ?? "Untitled evidence",
        description: text(item.description),
        observedAt: text(item.observedAt),
        score: type === "assessment" ? percent(item.score) : null,
        source,
        sourceHidden: rawSource !== null && source === null,
        demo: type === "project" ? safeLink(metadata.demo_url) : null,
        roadmapStep: type === "learning" && typeof step === "number" && Number.isInteger(step) ? step : null,
        created: time(text(item.createdAt)),
      }
    })
    .sort((a, b) => time(b.observedAt) - time(a.observedAt) || b.created - a.created)
    .map(({ created: _created, ...entry }) => entry)
}

export function countEvidence(entries: EvidenceEntry[]): EvidenceCount[] {
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1)
  return sortEvidenceCounts(counts)
}

// The most recent assessment result, if there is one.
export function latestAssessment(entries: EvidenceEntry[]): EvidenceEntry | null {
  return entries.find((entry) => entry.type === "assessment") ?? null
}

// Kinds of evidence this skill record has none of yet. Absence only: it says nothing
// about the user's ability.
export const EVIDENCE_KINDS = ["project", "learning", "assessment"] as const

export function missingEvidenceKinds(entries: EvidenceEntry[]): string[] {
  return EVIDENCE_KINDS.filter((kind) => !entries.some((entry) => entry.type === kind))
}

// --- Dates --------------------------------------------------------------------------------

export function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}
