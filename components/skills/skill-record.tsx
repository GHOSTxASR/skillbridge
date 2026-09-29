import Link from "next/link"
import { STATUS_LABEL } from "@/lib/skills/view"
import { formatDate, type SkillDetail } from "@/lib/skills/detail"

// The claim and the progress for one skill, as two separate panels. The claim is what the
// profile says; progress is what has been recorded. Neither implies the other.

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-xs text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function Panel({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="surface px-5 py-5">
      <h2 id={id} className="type-eyebrow text-muted-foreground">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function SkillClaim({ detail }: { detail: SkillDetail }) {
  const { skill, claimed, spellings } = detail

  return (
    <Panel id="skill-claim" title="From your profile">
      {claimed ? (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Self-reported. SkillBridge records it as a claim, not as proof.
          </p>
          <dl className="mt-2 divide-y divide-border">
            <Row label="Canonical skill">{skill.name}</Row>
            {spellings.map((spelling) => (
              <Row key={spelling.text} label={spelling.mapped ? "Mapped from your profile as" : "On your profile as"}>
                “{spelling.text}”
              </Row>
            ))}
          </dl>
        </>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {skill.name} isn&apos;t on your profile.{" "}
          <Link href="/account" className="font-medium text-primary underline-offset-4 hover:underline">
            Edit profile skills
          </Link>
        </p>
      )}
    </Panel>
  )
}

function Percent({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="h-1.5 w-16 overflow-hidden rounded-full bg-[oklch(1_0_0/8%)]">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </span>
      <span className="tabular-nums">{value}%</span>
    </span>
  )
}

export function SkillProgress({ detail }: { detail: SkillDetail }) {
  const progress = detail.progress

  return (
    <Panel id="skill-progress" title="Progress">
      {!progress ? (
        <p className="text-sm text-muted-foreground">No progress recorded yet.</p>
      ) : (
        <dl className="divide-y divide-border">
          <Row label="Status">{progress.status ? STATUS_LABEL[progress.status] : "Not recorded"}</Row>
          {progress.learningProgress !== null && (
            <Row label="Learning progress">
              <Percent value={progress.learningProgress} />
            </Row>
          )}
          {progress.practiceProgress !== null && (
            <Row label="Practice progress">
              <Percent value={progress.practiceProgress} />
            </Row>
          )}
          {formatDate(progress.firstObservedAt) && <Row label="First seen">{formatDate(progress.firstObservedAt)}</Row>}
          {formatDate(progress.lastActivityAt) && <Row label="Last active">{formatDate(progress.lastActivityAt)}</Row>}
          {formatDate(progress.lastAssessedAt) && <Row label="Last assessed">{formatDate(progress.lastAssessedAt)}</Row>}
        </dl>
      )}
    </Panel>
  )
}

export function SkillRecordSkeleton() {
  return (
    <div aria-hidden="true" className="surface px-5 py-5">
      <div className="skeleton h-3 w-28" />
      <div className="skeleton mt-4 h-3.5 w-full" />
      <div className="skeleton mt-3 h-3.5 w-3/4" />
      <div className="skeleton mt-3 h-3.5 w-2/3" />
    </div>
  )
}
