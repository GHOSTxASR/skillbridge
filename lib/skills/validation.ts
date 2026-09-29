// Request validation for the skill progress / evidence API. It mirrors the rules in
// supabase/migrations/20260928000000_skill_progress_evidence.sql so callers get a clear
// 400 before any database call; the database functions stay the authority and re-check
// everything (they are also reachable directly through the Data API).
//
// What a client may send is deliberately narrow: never a user id (the owner is always
// the signed-in user), never a score or confidence, never assessment evidence, and never
// the evidence-derived statuses assessed / proven.

export const MAX_BODY_LENGTH = 16_000

export const USER_EVIDENCE_TYPES = ["project", "learning"] as const
export type UserEvidenceType = (typeof USER_EVIDENCE_TYPES)[number]

export const USER_PROGRESS_STATUSES = ["not_started", "learning", "practicing"] as const
export type UserProgressStatus = (typeof USER_PROGRESS_STATUSES)[number]

const MAX_SKILLS_PER_EVIDENCE = 10
const MAX_TITLE = 200
const MAX_DESCRIPTION = 2000
const MAX_URL = 2048
const MAX_METADATA_BYTES = 4096
const EARLIEST = Date.UTC(2000, 0, 1)
const CLOCK_SKEW_MS = 5 * 60 * 1000

export type Invalid = { ok: false; status: 400 | 403; error: string }
export type Parsed<T> = { ok: true; value: T } | Invalid

const invalid = (error: string, status: 400 | 403 = 400): Invalid => ({ ok: false, status, error })

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

// Same rule as public.skill_evidence_url_ok: http(s), a plain host (so no
// user:password@), no whitespace, no credential-looking query parameters. Links are
// stored for people to open; SkillBridge never fetches them.
const URL_SHAPE = /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^\s]*)?$/
const SECRET_PARAM =
  /[?&#;](access_?token|id_?token|refresh_?token|token|secret|client_?secret|password|passwd|pwd|api_?key|apikey|key|sig|signature|auth)=/i

export function isEvidenceUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_URL &&
    URL_SHAPE.test(value) &&
    !SECRET_PARAM.test(value)
  )
}

// Title: one line. Description: may contain line breaks and tabs, no other control
// characters.
const TITLE_CONTROL = /[\u0000-\u001f\u007f]/
const DESCRIPTION_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function unexpectedKeys(body: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(body).filter((key) => !allowed.includes(key))
}

function parseTitle(value: unknown): Parsed<string> {
  if (typeof value !== "string") return invalid("title is required")
  const title = value.trim()
  if (!title || title.length > MAX_TITLE || TITLE_CONTROL.test(title)) {
    return invalid(`title must be 1 to ${MAX_TITLE} characters on one line`)
  }
  return { ok: true, value: title }
}

function parseDescription(value: unknown): Parsed<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== "string") return invalid("description must be text")
  const description = value.trim()
  if (description.length > MAX_DESCRIPTION || DESCRIPTION_CONTROL.test(description)) {
    return invalid(`description must be at most ${MAX_DESCRIPTION} characters`)
  }
  return { ok: true, value: description || null }
}

function parseSourceUrl(value: unknown): Parsed<string | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null }
  if (typeof value !== "string") return invalid("sourceUrl must be a link")
  const url = value.trim()
  if (!isEvidenceUrl(url)) return invalid("sourceUrl must be an http(s) link without credentials")
  return { ok: true, value: url }
}

// project:  { demo_url }
// learning: { roadmap_input_hash, roadmap_step, roadmap_skill } (all three or none); the
//           database also checks the step exists in the user's current roadmap.
export function parseEvidenceMetadata(
  type: UserEvidenceType,
  value: unknown
): Parsed<Record<string, unknown>> {
  if (value === undefined || value === null) return { ok: true, value: {} }
  if (!isPlainObject(value)) return invalid("metadata must be an object")

  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_METADATA_BYTES) {
    return invalid(`metadata must be at most ${MAX_METADATA_BYTES} bytes`)
  }

  const allowed =
    type === "project" ? ["demo_url"] : ["roadmap_input_hash", "roadmap_step", "roadmap_skill"]
  const extra = unexpectedKeys(value, allowed)
  if (extra.length) {
    return invalid(`metadata field(s) not allowed for ${type} evidence: ${extra.sort().join(", ")}`)
  }

  if (type === "project") {
    if ("demo_url" in value && !isEvidenceUrl(value.demo_url)) {
      return invalid("metadata.demo_url must be an http(s) link without credentials")
    }
    return { ok: true, value: { ...value } }
  }

  const keys = Object.keys(value)
  if (keys.length === 0) return { ok: true, value: {} }

  const hash = value.roadmap_input_hash
  const step = value.roadmap_step
  const skill = value.roadmap_skill
  if (
    keys.length !== 3 ||
    typeof hash !== "string" ||
    hash.length < 1 ||
    hash.length > 128 ||
    typeof skill !== "string" ||
    skill.length < 1 ||
    skill.length > 80 ||
    typeof step !== "number"
  ) {
    return invalid(
      "a roadmap reference needs roadmap_input_hash (text), roadmap_step (number) and roadmap_skill (text)"
    )
  }
  if (!Number.isInteger(step) || step < 1 || step > 50) {
    return invalid("metadata.roadmap_step must be a whole number from 1 to 50")
  }
  return { ok: true, value: { roadmap_input_hash: hash, roadmap_step: step, roadmap_skill: skill } }
}

function parseObservedAt(value: unknown, now: number): Parsed<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== "string") return invalid("observedAt must be an ISO date")
  const time = Date.parse(value)
  if (!Number.isFinite(time) || time < EARLIEST || time > now + CLOCK_SKEW_MS) {
    return invalid("observedAt must be a past date")
  }
  return { ok: true, value: new Date(time).toISOString() }
}

export type EvidenceCreate = {
  type: UserEvidenceType
  skillIds: string[]
  title: string
  description: string | null
  sourceUrl: string | null
  metadata: Record<string, unknown>
  observedAt: string | null
}

const CREATE_KEYS = ["type", "skillIds", "title", "description", "sourceUrl", "metadata", "observedAt"] as const

export function parseEvidenceCreate(body: unknown, now = Date.now()): Parsed<EvidenceCreate> {
  if (!isPlainObject(body)) return invalid("Request body must be a JSON object")

  // Rejects owner, score, confidence, assessment and any other field the client may
  // not decide, instead of silently ignoring them.
  const extra = unexpectedKeys(body, CREATE_KEYS)
  if (extra.length) return invalid(`unexpected field(s): ${extra.sort().join(", ")}`)

  if (body.type === "assessment") {
    return invalid("assessment evidence is recorded by SkillBridge from an assessment result, not submitted", 403)
  }
  // Learning evidence comes only from completing a real roadmap step (POST /api/skills/roadmap),
  // never from a client naming a skill.
  if (body.type === "learning") {
    return invalid("learning evidence is recorded by completing a step in your learning roadmap", 403)
  }
  if (!USER_EVIDENCE_TYPES.includes(body.type as UserEvidenceType)) {
    return invalid("type must be project")
  }
  const type = body.type as UserEvidenceType

  const ids = body.skillIds
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > MAX_SKILLS_PER_EVIDENCE ||
    !ids.every(isUuid) ||
    new Set(ids.map((id) => id.toLowerCase())).size !== ids.length
  ) {
    return invalid(`skillIds must be 1 to ${MAX_SKILLS_PER_EVIDENCE} different skill ids`)
  }

  const title = parseTitle(body.title)
  if (!title.ok) return title
  const description = parseDescription(body.description)
  if (!description.ok) return description
  const sourceUrl = parseSourceUrl(body.sourceUrl)
  if (!sourceUrl.ok) return sourceUrl
  const metadata = parseEvidenceMetadata(type, body.metadata)
  if (!metadata.ok) return metadata
  const observedAt = parseObservedAt(body.observedAt, now)
  if (!observedAt.ok) return observedAt

  return {
    ok: true,
    value: {
      type,
      skillIds: ids.map((id) => id.toLowerCase()),
      title: title.value,
      description: description.value,
      sourceUrl: sourceUrl.value,
      metadata: metadata.value,
      observedAt: observedAt.value,
    },
  }
}

export type EvidenceUpdate =
  | { action: "retract" }
  | {
      action: "edit"
      title?: string
      description?: string | null
      sourceUrl?: string | null
      metadata?: unknown
    }

const UPDATE_KEYS = ["title", "description", "sourceUrl", "metadata", "retracted"] as const

// Edits are validated again against the stored row's type (see the route); here only
// the shape and the fields that do not depend on the type.
export function parseEvidenceUpdate(body: unknown): Parsed<EvidenceUpdate> {
  if (!isPlainObject(body)) return invalid("Request body must be a JSON object")
  const extra = unexpectedKeys(body, UPDATE_KEYS)
  if (extra.length) return invalid(`unexpected field(s): ${extra.sort().join(", ")}`)

  if ("retracted" in body) {
    if (body.retracted !== true || Object.keys(body).length !== 1) {
      return invalid('to retract, send only { "retracted": true }; retraction cannot be undone')
    }
    return { ok: true, value: { action: "retract" } }
  }

  if (Object.keys(body).length === 0) return invalid("nothing to update")

  const value: EvidenceUpdate = { action: "edit" }
  if ("title" in body) {
    const title = parseTitle(body.title)
    if (!title.ok) return title
    value.title = title.value
  }
  if ("description" in body) {
    const description = parseDescription(body.description)
    if (!description.ok) return description
    value.description = description.value
  }
  if ("sourceUrl" in body) {
    const sourceUrl = parseSourceUrl(body.sourceUrl)
    if (!sourceUrl.ok) return sourceUrl
    value.sourceUrl = sourceUrl.value
  }
  if ("metadata" in body) value.metadata = body.metadata
  return { ok: true, value }
}

export type ProgressUpdate = { skillId: string; status: UserProgressStatus }

export function parseProgressUpdate(body: unknown): Parsed<ProgressUpdate> {
  if (!isPlainObject(body)) return invalid("Request body must be a JSON object")
  const extra = unexpectedKeys(body, ["skillId", "status"])
  if (extra.length) return invalid(`unexpected field(s): ${extra.sort().join(", ")}`)
  if (!isUuid(body.skillId)) return invalid("skillId must be a skill id")
  if (body.status === "assessed" || body.status === "proven") {
    return invalid("assessed and proven come from evidence and cannot be set by hand", 403)
  }
  if (!USER_PROGRESS_STATUSES.includes(body.status as UserProgressStatus)) {
    return invalid("status must be not_started, learning or practicing")
  }
  return {
    ok: true,
    value: { skillId: body.skillId.toLowerCase(), status: body.status as UserProgressStatus },
  }
}
