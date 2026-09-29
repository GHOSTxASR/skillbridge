import { isPlainObject, isUuid } from "@/lib/skills/validation"

// POST /api/skills/roadmap body: which step of which trusted roadmap version. Nothing else
// is accepted: skill, title, description, roadmap content, hashes, timestamps, statuses,
// scores and owners all come from the database, never from the client.

export const MAX_ROADMAP_STEP = 50

export type RoadmapCompletionRequest = { versionId: string; stepOrder: number }

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const COMPLETION_KEYS = ["versionId", "stepOrder"]

export function parseRoadmapCompletion(body: unknown): Parsed<RoadmapCompletionRequest> {
  if (!isPlainObject(body)) return { ok: false, error: "Request body must be a JSON object" }
  const extra = Object.keys(body).filter((key) => !COMPLETION_KEYS.includes(key))
  if (extra.length) return { ok: false, error: `unexpected field(s): ${extra.sort().join(", ")}` }

  const { versionId, stepOrder } = body
  if (!isUuid(versionId)) return { ok: false, error: "versionId must be a roadmap version id" }
  if (typeof stepOrder !== "number" || !Number.isInteger(stepOrder) || stepOrder < 1 || stepOrder > MAX_ROADMAP_STEP) {
    return { ok: false, error: `stepOrder must be a whole number from 1 to ${MAX_ROADMAP_STEP}` }
  }
  return { ok: true, value: { versionId: versionId.toLowerCase(), stepOrder } }
}
