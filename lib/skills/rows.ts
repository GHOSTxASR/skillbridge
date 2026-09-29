import type { SkillResolution } from "@/lib/skills/catalog"

// Database rows -> API shape for /api/skills. Columns are listed once here so every route
// selects the same fields.

export const PROGRESS_COLUMNS =
  "skill_id, status, confidence_score, confidence_updated_at, learning_progress, practice_progress, " +
  "latest_assessment_evidence_id, last_assessed_at, first_observed_at, last_activity_at, created_at, updated_at"

export const EVIDENCE_COLUMNS =
  "id, skill_id, evidence_type, title, description, source_url, score, assessment_id, group_id, " +
  "metadata, observed_at, retracted_at, created_at, updated_at"

type Row = Record<string, unknown>

const text = (value: unknown) => (typeof value === "string" ? value : null)
const num = (value: unknown) =>
  typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : null

function skillOf(row: Row) {
  const skill = row.skills
  if (skill && typeof skill === "object" && !Array.isArray(skill)) {
    const s = skill as Row
    return { name: text(s.name), category: text(s.category) }
  }
  return null
}

// confidence is null until SkillBridge has a confidence model; it is never derived from
// what the user claims. selfReported (the skill is on the user's profile) is null when the
// caller did not check the profile.
export function toProgress(row: Row, selfReported: boolean | null = null) {
  const score = num(row.confidence_score)
  return {
    skillId: text(row.skill_id),
    skill: skillOf(row),
    status: text(row.status),
    selfReported,
    confidence: score === null ? null : { score, updatedAt: text(row.confidence_updated_at) },
    learningProgress: num(row.learning_progress),
    practiceProgress: num(row.practice_progress),
    latestAssessmentEvidenceId: text(row.latest_assessment_evidence_id),
    lastAssessedAt: text(row.last_assessed_at),
    firstObservedAt: text(row.first_observed_at),
    lastActivityAt: text(row.last_activity_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  }
}

// A skill named on the user's profile, resolved to the catalog. A claim is "the user says
// so": it has no status, evidence or confidence. skillId, canonicalName and category are
// null when the catalog has no such skill.
export function toClaim(resolution: SkillResolution) {
  return {
    name: resolution.input,
    skillId: resolution.skill?.id ?? null,
    canonicalName: resolution.skill?.name ?? null,
    category: resolution.skill?.category ?? null,
    matchedBy: resolution.matchedBy,
  }
}

export function toEvidence(row: Row) {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {}
  return {
    id: text(row.id),
    skillId: text(row.skill_id),
    skill: skillOf(row),
    type: text(row.evidence_type),
    title: text(row.title),
    description: text(row.description),
    sourceUrl: text(row.source_url),
    // Only assessment evidence has a score, recorded by SkillBridge.
    score: num(row.score),
    assessmentId: text(row.assessment_id),
    groupId: text(row.group_id),
    metadata,
    observedAt: text(row.observed_at),
    retracted: row.retracted_at != null,
    retractedAt: text(row.retracted_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  }
}
