import type { toClaim, toEvidence, toProgress } from "@/lib/skills/rows"

// The Skills page's view of one user's skills, built only from what the API returns:
//
//   GET /api/skills/progress -> { progress, claims }   (claims resolved by the server)
//   GET /api/skills/evidence -> { evidence }
//
// The server is the authority on skill identity: every record is keyed by the catalog
// skill id the API returned, and names and categories are the catalog's. Nothing here
// resolves, renames or merges skill names, and nothing is inferred: a claim stays a claim,
// a status is shown only when a progress row has one, and evidence is counted, never scored.

export type ClaimItem = ReturnType<typeof toClaim>
export type ProgressItem = ReturnType<typeof toProgress>
export type EvidenceItem = ReturnType<typeof toEvidence>

export type ProgressResponse = { progress: ProgressItem[]; claims: ClaimItem[] }
export type EvidenceResponse = { evidence: EvidenceItem[] }

export const PROGRESS_STATUSES = ["not_started", "learning", "practicing", "assessed", "proven"] as const
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number]

export const STATUS_LABEL: Record<ProgressStatus, string> = {
  not_started: "Not started",
  learning: "Learning",
  practicing: "Practicing",
  assessed: "Assessed",
  proven: "Proven",
}

export function progressStatus(value: unknown): ProgressStatus | null {
  return PROGRESS_STATUSES.includes(value as ProgressStatus) ? (value as ProgressStatus) : null
}

export type EvidenceCount = { type: string; count: number }

export type SkillRecord = {
  skillId: string
  name: string
  category: string | null
  // On the user's profile. Says nothing about ability.
  claimed: boolean
  // Profile spellings the server matched by alias or level word ("React.js", "SQL Advanced").
  claimedAs: string[]
  // From the progress row; null when there is none.
  status: ProgressStatus | null
  lastActivityAt: string | null
  lastAssessedAt: string | null
  // null when evidence could not be loaded: unknown, which is not the same as none.
  evidence: { total: number; byType: EvidenceCount[] } | null
}

export type SkillCollection = {
  records: SkillRecord[]
  // Profile skills the catalog has no skill for. Listed, never guessed.
  unrecognised: string[]
  evidenceAvailable: boolean
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null)

// Parses a response body defensively; anything that is not the documented shape is an error.
export function readProgressResponse(body: unknown): ProgressResponse | null {
  if (!body || typeof body !== "object") return null
  const { progress, claims } = body as Record<string, unknown>
  if (!Array.isArray(progress) || !Array.isArray(claims)) return null
  return { progress: progress as ProgressItem[], claims: claims as ClaimItem[] }
}

export function readEvidenceResponse(body: unknown): EvidenceResponse | null {
  if (!body || typeof body !== "object") return null
  const { evidence } = body as Record<string, unknown>
  if (!Array.isArray(evidence)) return null
  return { evidence: evidence as EvidenceItem[] }
}

// Assessments are listed first, then projects, then learning; any other type after them.
const EVIDENCE_ORDER = ["assessment", "project", "learning"]

export function sortEvidenceCounts(counts: Map<string, number>): EvidenceCount[] {
  const rank = (type: string) => {
    const index = EVIDENCE_ORDER.indexOf(type)
    return index === -1 ? EVIDENCE_ORDER.length : index
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => rank(a.type) - rank(b.type) || a.type.localeCompare(b.type))
}

export function buildSkillCollection(
  progressResponse: ProgressResponse,
  evidenceResponse: EvidenceResponse | null
): SkillCollection {
  const records = new Map<string, SkillRecord>()
  const evidenceAvailable = evidenceResponse !== null

  const recordFor = (skillId: string, name: string, category: string | null) => {
    let record = records.get(skillId)
    if (!record) {
      record = {
        skillId,
        name,
        category,
        claimed: false,
        claimedAs: [],
        status: null,
        lastActivityAt: null,
        lastAssessedAt: null,
        evidence: evidenceAvailable ? { total: 0, byType: [] } : null,
      }
      records.set(skillId, record)
    }
    record.category ??= category
    return record
  }

  const unrecognised: string[] = []
  const seenUnrecognised = new Set<string>()

  for (const claim of progressResponse.claims) {
    const skillId = text(claim?.skillId)
    const canonicalName = text(claim?.canonicalName)
    if (!skillId || !canonicalName) {
      const name = text(claim?.name)
      if (name && !seenUnrecognised.has(name.toLowerCase())) {
        seenUnrecognised.add(name.toLowerCase())
        unrecognised.push(name)
      }
      continue
    }
    const record = recordFor(skillId, canonicalName, text(claim.category))
    record.claimed = true
    const spelling = text(claim.name)
    if (
      spelling &&
      (claim.matchedBy === "alias" || claim.matchedBy === "level") &&
      !record.claimedAs.some((known) => known.toLowerCase() === spelling.toLowerCase())
    ) {
      record.claimedAs.push(spelling)
    }
  }

  for (const row of progressResponse.progress) {
    const skillId = text(row?.skillId)
    const name = text(row?.skill?.name)
    if (!skillId || !name) continue
    const record = recordFor(skillId, name, text(row.skill?.category))
    record.status = progressStatus(row.status)
    record.lastActivityAt = text(row.lastActivityAt)
    record.lastAssessedAt = text(row.lastAssessedAt)
  }

  if (evidenceResponse) {
    const tallies = new Map<string, Map<string, number>>()
    for (const item of evidenceResponse.evidence) {
      const skillId = text(item?.skillId)
      const name = text(item?.skill?.name)
      const type = text(item?.type)
      if (!skillId || !name || !type || item.retracted === true) continue
      recordFor(skillId, name, text(item.skill?.category))
      const tally = tallies.get(skillId) ?? new Map<string, number>()
      tally.set(type, (tally.get(type) ?? 0) + 1)
      tallies.set(skillId, tally)
    }
    for (const [skillId, tally] of tallies) {
      const byType = sortEvidenceCounts(tally)
      records.get(skillId)!.evidence = { total: byType.reduce((sum, entry) => sum + entry.count, 0), byType }
    }
  }

  // Most recently active first, then by name.
  const sorted = [...records.values()].sort((a, b) => {
    const at = a.lastActivityAt ? Date.parse(a.lastActivityAt) : -Infinity
    const bt = b.lastActivityAt ? Date.parse(b.lastActivityAt) : -Infinity
    return bt - at || a.name.localeCompare(b.name)
  })

  return { records: sorted, unrecognised, evidenceAvailable }
}

export type SkillSummary = {
  total: number
  claimed: number
  learning: number
  practicing: number
  assessed: number
  // null when evidence could not be loaded.
  withEvidence: number | null
}

export function summarize(collection: SkillCollection): SkillSummary {
  const { records } = collection
  const count = (test: (record: SkillRecord) => boolean) => records.filter(test).length
  return {
    total: records.length,
    claimed: count((r) => r.claimed),
    learning: count((r) => r.status === "learning"),
    practicing: count((r) => r.status === "practicing"),
    assessed: count((r) => r.status === "assessed"),
    withEvidence: collection.evidenceAvailable ? count((r) => (r.evidence?.total ?? 0) > 0) : null,
  }
}

// --- Evidence wording -------------------------------------------------------------------

const EVIDENCE_NOUN: Record<string, [string, string]> = {
  assessment: ["assessment", "assessments"],
  project: ["project", "projects"],
  learning: ["learning activity", "learning activities"],
  ai_interview: ["AI interview", "AI interviews"],
}

// One evidence item's type, as a heading ("Learning activity").
export const EVIDENCE_LABEL: Record<string, string> = {
  project: "Project",
  learning: "Learning activity",
  assessment: "Assessment",
  ai_interview: "AI interview",
}

// "2 projects · 1 assessment". Only the types that are actually present.
export function describeEvidence(byType: EvidenceCount[]): string {
  return byType
    .map(({ type, count }) => {
      const [one, many] = EVIDENCE_NOUN[type] ?? ["other item", "other items"]
      return `${count} ${count === 1 ? one : many}`
    })
    .join(" · ")
}

// --- Filters ------------------------------------------------------------------------------

export type StatusFilter = "all" | "claimed" | ProgressStatus | "with_evidence"

export function matchesStatus(record: SkillRecord, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true
    case "claimed":
      return record.claimed
    case "with_evidence":
      return (record.evidence?.total ?? 0) > 0
    // Cards show "Not started" both with no progress row and for that stored status.
    case "not_started":
      return record.status === null || record.status === "not_started"
    default:
      return record.status === filter
  }
}

export type FilterOption = { id: StatusFilter; label: string; count: number }

// The filters always offered, plus a status filter only when some skill has that status.
// "With evidence" needs the evidence to have loaded.
export function statusFilters(collection: SkillCollection): FilterOption[] {
  const option = (id: StatusFilter, label: string): FilterOption => ({
    id,
    label,
    count: collection.records.filter((record) => matchesStatus(record, id)).length,
  })
  const options = [
    option("all", "All"),
    option("claimed", "Claimed"),
    option("learning", STATUS_LABEL.learning),
    option("practicing", STATUS_LABEL.practicing),
    option("assessed", STATUS_LABEL.assessed),
  ]
  for (const status of ["not_started", "proven"] as const) {
    const extra = option(status, STATUS_LABEL[status])
    if (extra.count > 0) options.push(extra)
  }
  if (collection.evidenceAvailable) options.push(option("with_evidence", "With evidence"))
  return options
}

// Categories exactly as the catalog names them, for the skills shown.
export function categoriesOf(records: SkillRecord[]): string[] {
  return [...new Set(records.map((record) => record.category).filter((c): c is string => !!c))].sort((a, b) =>
    a.localeCompare(b)
  )
}

export type SkillFilters = { query: string; status: StatusFilter; category: string | null }

// Search is a plain case-insensitive match on the canonical name shown on the card.
export function filterRecords(records: SkillRecord[], filters: SkillFilters): SkillRecord[] {
  const query = filters.query.trim().toLowerCase()
  return records.filter(
    (record) =>
      matchesStatus(record, filters.status) &&
      (filters.category === null || record.category === filters.category) &&
      (!query || record.name.toLowerCase().includes(query))
  )
}

// --- Dates --------------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000

export function relativeDay(iso: string, now: number = Date.now()): string | null {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  const startOf = (t: number) => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const days = Math.round((startOf(now) - startOf(time)) / DAY)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days} days ago`
  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`
  }
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}
