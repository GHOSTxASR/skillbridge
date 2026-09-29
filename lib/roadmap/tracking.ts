import { isPlainObject, isUuid } from "@/lib/skills/validation"
import { progressStatus, type ProgressStatus } from "@/lib/skills/view"

// Learning-step tracking on the roadmap page, built only from GET /api/skills/roadmap (the
// user's latest trusted, immutable roadmap version). The roadmap shown on the page comes from
// /api/learning, a display cache that is never trusted: it is used here only to decide which
// shown step a trusted step belongs to, and only when both are the same generated roadmap.
//
// The browser never decides what is recorded. Completing a step sends { versionId, stepOrder }
// and nothing else; the server derives the skill, title, description and snapshot from the
// version. Completing a step records learning evidence: it does not verify, assess or score
// the skill, and it does not set confidence or readiness.

export type TrustedStep = {
  order: number
  skill: string
  // The catalog skill the server resolved when the roadmap was generated; null when none.
  skillId: string | null
  skillName: string | null
  completed: boolean
}

export type TrustedRoadmap =
  | { available: false }
  | { available: true; versionId: string; generatedAt: string; steps: TrustedStep[] }

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null)

// Validates the GET /api/skills/roadmap body. Anything malformed is rejected as a whole,
// so the page never shows a completion state it could not read.
export function readTrustedRoadmap(body: unknown): TrustedRoadmap | null {
  if (!isPlainObject(body)) return null
  if (body.available === false) return { available: false }
  if (body.available !== true || !isUuid(body.versionId) || !text(body.generatedAt) || !Array.isArray(body.steps)) return null
  if (Number.isNaN(Date.parse(body.generatedAt as string))) return null

  const steps: TrustedStep[] = []
  for (const item of body.steps) {
    if (!isPlainObject(item)) return null
    const { order, skill, skillId, skillName, completed } = item
    if (typeof order !== "number" || !Number.isInteger(order) || order < 1) return null
    if (!text(skill) || typeof completed !== "boolean") return null
    if (skillId !== null && !isUuid(skillId)) return null
    steps.push({
      order,
      skill: skill as string,
      skillId: skillId as string | null,
      skillName: skillId === null ? null : text(skillName),
      completed: skillId !== null && completed,
    })
  }
  return { available: true, versionId: body.versionId as string, generatedAt: body.generatedAt as string, steps }
}

// One shown step's tracking state.
export type StepTracking =
  | { kind: "available"; order: number; skillId: string; skillName: string | null }
  | { kind: "completed"; order: number; skillId: string; skillName: string | null }
  // SkillBridge couldn't map the roadmap's skill to a catalog skill: nothing can be recorded.
  | { kind: "unmatched"; order: number }

export type RoadmapTracking =
  | { status: "ready"; versionId: string; steps: StepTracking[] }
  // no_version: no trusted version yet (roadmaps generated before tracking existed).
  // basic:      the general fallback roadmap shown while AI is unavailable.
  // mismatch:   the shown roadmap is not the latest trusted version.
  | { status: "unavailable"; reason: "no_version" | "basic" | "mismatch" }

export type DisplayStep = { order?: number; skill: string }

const sameInstant = (a: string, b: string) => {
  const x = Date.parse(a)
  const y = Date.parse(b)
  return !Number.isNaN(x) && x === y
}

// Links the shown roadmap to the trusted version, all or nothing: the same generation time,
// the same number of steps, and the same skill text at every position. Anything else means
// the page is showing a different roadmap, and no step offers completion.
export function linkTracking(
  display: { steps: DisplayStep[]; generatedAt?: string; aiAvailable?: boolean },
  trusted: TrustedRoadmap
): RoadmapTracking {
  if (display.aiAvailable === false) return { status: "unavailable", reason: "basic" }
  if (!trusted.available) return { status: "unavailable", reason: "no_version" }
  if (!display.generatedAt || !sameInstant(display.generatedAt, trusted.generatedAt)) {
    return { status: "unavailable", reason: "mismatch" }
  }
  if (display.steps.length !== trusted.steps.length) return { status: "unavailable", reason: "mismatch" }

  const steps: StepTracking[] = []
  for (let index = 0; index < display.steps.length; index++) {
    const shown = display.steps[index]
    const order = shown.order ?? index + 1
    const step = trusted.steps.find((candidate) => candidate.order === order)
    if (!step || step.skill !== shown.skill) return { status: "unavailable", reason: "mismatch" }
    if (step.skillId === null) steps.push({ kind: "unmatched", order })
    else steps.push({ kind: step.completed ? "completed" : "available", order, skillId: step.skillId, skillName: step.skillName })
  }
  return { status: "ready", versionId: trusted.versionId, steps }
}

// Roadmap learning progress only: how many steps have learning recorded. Not mastery, not
// confidence and not readiness.
export type TrackingSummary = {
  total: number
  trackable: number
  completed: number
  unmatched: number
  headline: string
  detail: string
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export function trackingSummary(steps: StepTracking[]): TrackingSummary {
  const total = steps.length
  const completed = steps.filter((step) => step.kind === "completed").length
  const unmatched = steps.filter((step) => step.kind === "unmatched").length
  const trackable = total - unmatched

  const allDone = total > 0 && completed === total
  const allTrackableDone = !allDone && trackable > 0 && completed === trackable
  const headline = allDone
    ? "All learning steps completed"
    : allTrackableDone
      ? "All trackable learning steps completed"
      : `${completed} of ${plural(total, "learning step", "learning steps")} completed`

  // The legend lists the counts; the detail only keeps the plain count when the headline
  // doesn't say it.
  const detail = allTrackableDone ? `${completed} of ${plural(total, "step", "steps")} completed` : ""

  return { total, trackable, completed, unmatched, headline, detail }
}

// The only body the browser ever sends to POST /api/skills/roadmap.
export function completionBody(versionId: string, stepOrder: number) {
  return JSON.stringify({ versionId, stepOrder })
}

export type CompletionOutcome =
  | { kind: "completed"; created: boolean; skillName: string | null; progress: ProgressStatus | null }
  | { kind: "stale" }
  | { kind: "limit" }
  | { kind: "unmatched" }
  | { kind: "not_found" }
  | { kind: "signed_out" }
  | { kind: "failed"; offline: boolean }

// Maps a POST /api/skills/roadmap result (status null: no response) to what the page does.
// Server messages and codes are never shown as-is.
export function completionOutcome(status: number | null, body: unknown): CompletionOutcome {
  if (status === null) return { kind: "failed", offline: true }
  const data = isPlainObject(body) ? body : {}
  if ((status === 200 || status === 201) && data.ok === true) {
    const step = isPlainObject(data.step) ? data.step : {}
    const progress = isPlainObject(data.progress) ? data.progress : {}
    return {
      kind: "completed",
      created: status === 201 && data.created === true,
      skillName: text(step.skillName),
      progress: progressStatus(progress.status),
    }
  }
  if (status === 401) return { kind: "signed_out" }
  if (status === 404) return { kind: "not_found" }
  if (status === 422) return { kind: "unmatched" }
  if (status === 409) return data.code === "evidence_limit" ? { kind: "limit" } : { kind: "stale" }
  return { kind: "failed", offline: false }
}

// Applies a result to the trusted state held by the page. Completion is only ever marked
// after the server confirmed it; a 422 turns the step into an unmatched one.
export function applyOutcome(trusted: TrustedRoadmap, order: number, outcome: CompletionOutcome): TrustedRoadmap {
  if (!trusted.available) return trusted
  if (outcome.kind !== "completed" && outcome.kind !== "unmatched") return trusted
  return {
    ...trusted,
    steps: trusted.steps.map((step) => {
      if (step.order !== order) return step
      if (outcome.kind === "unmatched") return { ...step, skillId: null, skillName: null, completed: false }
      return step.skillId === null ? step : { ...step, completed: true }
    }),
  }
}
