import Link from "next/link"
import { ChevronRight, CircleAlert, FileCheck2, Footprints, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { STATUS_LABEL, describeEvidence, relativeDay, type SkillRecord } from "@/lib/skills/view"

// One skill as three separate facts: whether it is on the profile (a claim), what progress
// is recorded, and what evidence exists. They are never combined into one badge or score,
// and each fact is written out in words, so colour only reinforces what the text says.
// The skill's name links to its detail page; the link covers the whole card, so the card
// is one focus stop and one click target.

function Fact({
  icon: Icon,
  label,
  present,
  children,
}: {
  icon: React.ElementType
  label: string
  present: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <dt className="flex w-[5.5rem] shrink-0 items-center gap-2 text-xs text-subtle-foreground">
        <Icon aria-hidden="true" className={cn("size-3.5", present ? "text-primary" : "text-subtle-foreground/70")} />
        {label}
      </dt>
      <dd className={cn("min-w-0 text-sm", present ? "font-medium text-foreground" : "text-muted-foreground")}>
        {children}
      </dd>
    </div>
  )
}

function When({ label, iso }: { label: string; iso: string }) {
  const relative = relativeDay(iso)
  if (!relative) return null
  return (
    <p>
      {label}{" "}
      <time dateTime={iso} title={new Date(iso).toLocaleString()}>
        {relative}
      </time>
    </p>
  )
}

export function SkillCard({ record, index = 0 }: { record: SkillRecord; index?: number }) {
  const { name, category, claimed, claimedAs, status, evidence, lastActivityAt, lastAssessedAt } = record
  const titleId = `skill-${record.skillId}`
  const hasEvidence = (evidence?.total ?? 0) > 0
  const claimOnly = claimed && status === null && evidence !== null && evidence.total === 0

  return (
    <article
      aria-labelledby={titleId}
      className="reveal surface group relative flex h-full flex-col p-5 transition-[border-color,background-color] duration-200 hover:border-border-strong hover:bg-[oklch(0.2_0.014_262)] has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring has-[a:focus-visible]:[outline-style:solid]"
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
    >
      <header className="pr-6">
        <p className="type-eyebrow text-subtle-foreground">{category ?? "Uncategorised"}</p>
        <h3 id={titleId} className="mt-1.5 break-words text-lg font-semibold tracking-[-0.015em] text-foreground">
          <Link
            href={`/skills/${record.skillId}`}
            className="outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
          >
            {name}
          </Link>
        </h3>
        <ChevronRight
          aria-hidden="true"
          className="absolute right-4 top-5 size-4 text-subtle-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground"
        />
        {claimedAs.length > 0 && (
          <p className="mt-1 truncate text-xs text-subtle-foreground">
            On your profile as {claimedAs.map((spelling) => `“${spelling}”`).join(", ")}
          </p>
        )}
      </header>

      <dl className="mt-5 space-y-2.5">
        <Fact icon={UserRound} label="Claim" present={claimed}>
          {claimed ? "Claimed" : "Not claimed"}
          {claimed && <span className="sr-only"> on your profile, not verified</span>}
        </Fact>
        <Fact icon={Footprints} label="Progress" present={status !== null && status !== "not_started"}>
          {status ? STATUS_LABEL[status] : "Not started"}
          {!status && <span className="sr-only"> (no progress recorded yet)</span>}
        </Fact>
        <Fact icon={evidence === null ? CircleAlert : FileCheck2} label="Evidence" present={hasEvidence}>
          {evidence === null ? (
            <span className="text-warning">Couldn&apos;t load evidence</span>
          ) : hasEvidence ? (
            describeEvidence(evidence.byType)
          ) : (
            "No evidence yet"
          )}
        </Fact>
      </dl>

      <div className="mt-auto space-y-1 pt-5 text-xs leading-relaxed text-subtle-foreground">
        {claimOnly ? (
          <p className="text-pretty">
            Claimed from your profile. Add learning or project evidence later to build a stronger skill record.
          </p>
        ) : (
          <>
            {lastActivityAt && <When label="Last active" iso={lastActivityAt} />}
            {lastAssessedAt && <When label="Last assessed" iso={lastAssessedAt} />}
          </>
        )}
      </div>
    </article>
  )
}

export function SkillCardSkeleton() {
  return (
    <div aria-hidden="true" className="surface flex h-full flex-col p-5">
      <div className="skeleton h-3 w-20" />
      <div className="skeleton mt-3 h-5 w-32" />
      <div className="mt-6 space-y-3.5">
        <div className="skeleton h-3.5 w-3/4" />
        <div className="skeleton h-3.5 w-2/3" />
        <div className="skeleton h-3.5 w-4/5" />
      </div>
      <div className="skeleton mt-7 h-3 w-full" />
      <div className="skeleton mt-2 h-3 w-1/2" />
    </div>
  )
}
