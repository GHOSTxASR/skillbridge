import { ClipboardCheck, FileCheck2, Footprints, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { describeEvidence, STATUS_LABEL } from "@/lib/skills/view"
import { countEvidence, formatDate, latestAssessment, type EvidenceEntry, type SkillDetail } from "@/lib/skills/detail"

// "Your status": claim, progress, evidence and assessment side by side, each answered on
// its own. A part that is still loading shows a placeholder; a part that failed says so
// instead of looking empty.

export type Part<T> = { state: "loading" } | { state: "error" } | { state: "ready"; value: T }

function Cell({
  icon: Icon,
  label,
  value,
  note,
  present = false,
  failed = false,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode | null
  note?: React.ReactNode
  present?: boolean
  failed?: boolean
}) {
  return (
    <div className="min-w-0 bg-card px-5 py-5">
      <dt className="type-eyebrow flex items-center gap-2 text-subtle-foreground">
        <Icon aria-hidden="true" className={cn("size-3.5", present ? "text-primary" : "text-subtle-foreground/70")} />
        {label}
      </dt>
      <dd className="mt-2.5">
        {value === null ? (
          <>
            <span className="sr-only">Loading</span>
            <span aria-hidden="true" className="skeleton block h-5 w-24" />
          </>
        ) : (
          <span
            className={cn(
              "block text-base font-semibold tracking-[-0.01em]",
              failed ? "text-warning" : present ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {value}
          </span>
        )}
        {note && value !== null && <span className="mt-1 block text-xs leading-relaxed text-subtle-foreground">{note}</span>}
      </dd>
    </div>
  )
}

export function SkillStatusPanel({
  detail,
  evidence,
}: {
  detail: Part<SkillDetail>
  evidence: Part<EvidenceEntry[]>
}) {
  const ready = detail.state === "ready" ? detail.value : null
  const entries = evidence.state === "ready" ? evidence.value : null
  const assessment = entries ? latestAssessment(entries) : null
  const lastAssessedAt = ready?.progress?.lastAssessedAt ?? null

  const claim =
    detail.state === "loading" ? null : detail.state === "error" ? "Couldn't load" : ready!.claimed ? "On your profile" : "Not on profile"
  const progress =
    detail.state === "loading"
      ? null
      : detail.state === "error"
        ? "Couldn't load"
        : ready!.progress?.status
          ? STATUS_LABEL[ready!.progress.status]
          : "Not started"
  const evidenceValue =
    evidence.state === "loading"
      ? null
      : evidence.state === "error"
        ? "Couldn't load evidence"
        : entries!.length === 0
          ? "No evidence yet"
          : `${entries!.length} ${entries!.length === 1 ? "item" : "items"}`

  // Assessment comes from assessment evidence (with its recorded score) or from the progress
  // row's last assessment date. A claim never counts as one.
  let assessmentValue: string | null = null
  let assessmentNote: string | null = null
  if (assessment) {
    assessmentValue = assessment.score !== null ? `Score ${assessment.score}/100` : "Assessed"
    assessmentNote = assessment.observedAt ? `Observed ${formatDate(assessment.observedAt)}` : null
  } else if (lastAssessedAt) {
    assessmentValue = "Assessed"
    assessmentNote = `Last assessed ${formatDate(lastAssessedAt)}`
  } else if (ready) {
    assessmentValue = "Not assessed"
  } else if (detail.state === "error" && entries) {
    assessmentValue = "Not assessed"
  } else if (detail.state === "error") {
    assessmentValue = "Couldn't load"
  }

  return (
    <section aria-labelledby="skill-status" className="surface overflow-hidden">
      <h2 id="skill-status" className="type-eyebrow border-b border-border px-5 py-3.5 text-muted-foreground">
        Your status
      </h2>
      {/* 1px gaps over a border-coloured background draw the dividers at every breakpoint. */}
      <dl className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
        <Cell
          icon={UserRound}
          label="Claim"
          value={claim}
          present={ready?.claimed === true}
          failed={detail.state === "error"}
          note={ready?.claimed ? "Self-reported, not verified" : undefined}
        />
        <Cell
          icon={Footprints}
          label="Progress"
          value={progress}
          present={!!ready?.progress?.status && ready.progress.status !== "not_started"}
          failed={detail.state === "error"}
          note={ready && !ready.progress ? "No progress recorded yet" : undefined}
        />
        <Cell
          icon={FileCheck2}
          label="Evidence"
          value={evidenceValue}
          present={!!entries && entries.length > 0}
          failed={evidence.state === "error"}
          note={entries && entries.length > 0 ? describeEvidence(countEvidence(entries)) : undefined}
        />
        <Cell
          icon={ClipboardCheck}
          label="Assessment"
          value={assessmentValue}
          present={!!assessment || !!lastAssessedAt}
          failed={assessmentValue === "Couldn't load"}
          note={assessmentNote}
        />
      </dl>
    </section>
  )
}
