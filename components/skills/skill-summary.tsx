import { ChevronRight, FileCheck2, Footprints, UserRound } from "lucide-react"
import type { SkillSummary as Summary } from "@/lib/skills/view"

// Claim -> progress -> evidence, read left to right as three separate questions. Only
// counts the API data supports; there is no overall score, confidence or readiness here.

function Metric({ value, label }: { value: number | null; label: string }) {
  return (
    <p className="flex items-baseline gap-2 whitespace-nowrap">
      <span className="type-metric text-3xl text-foreground">{value ?? "—"}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </p>
  )
}

function Stage({
  icon: Icon,
  title,
  question,
  last = false,
  children,
}: {
  icon: React.ElementType
  title: string
  question: string
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <li className="relative flex items-center justify-between gap-6 px-5 py-5 md:block md:px-6 md:py-6">
      <div className="min-w-0">
        <p className="type-eyebrow flex items-center gap-2 text-subtle-foreground">
          <Icon aria-hidden="true" className="size-3.5 text-primary" />
          {title}
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">{question}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 md:mt-5 md:flex-row md:flex-wrap md:items-baseline md:gap-x-6">
        {children}
      </div>
      {!last && (
        <span
          aria-hidden="true"
          className="absolute -right-3 top-1/2 z-10 hidden size-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-subtle-foreground md:flex"
        >
          <ChevronRight className="size-3.5" />
        </span>
      )}
    </li>
  )
}

export function SkillSummary({ summary, className }: { summary: Summary; className?: string }) {
  return (
    <section aria-labelledby="skills-summary" className={className}>
      <h2 id="skills-summary" className="sr-only">
        Summary
      </h2>
      <ol className="surface grid grid-cols-1 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
        <Stage icon={UserRound} title="Claimed" question="What you say you know">
          <Metric value={summary.claimed} label="on your profile" />
        </Stage>
        <Stage icon={Footprints} title="Working on" question="What you're learning and practicing">
          <Metric value={summary.learning} label="learning" />
          <Metric value={summary.practicing} label="practicing" />
        </Stage>
        <Stage icon={FileCheck2} title="Demonstrated" question="What you've shown with evidence" last>
          <Metric value={summary.withEvidence} label="with evidence" />
          {summary.assessed > 0 && <Metric value={summary.assessed} label="assessed" />}
        </Stage>
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-subtle-foreground">
        A claim is what your profile says. Evidence is what you&apos;ve shown. SkillBridge keeps them apart, so a
        claim is never counted as proof.
      </p>
    </section>
  )
}

export function SkillSummarySkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={className}>
      <div className="surface grid grid-cols-1 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between gap-6 px-5 py-5 md:block md:px-6 md:py-6">
            <div>
              <div className="skeleton h-3 w-20" />
              <div className="skeleton mt-2.5 h-3.5 w-40" />
            </div>
            <div className="skeleton h-8 w-16 md:mt-5" />
          </div>
        ))}
      </div>
      <div className="skeleton mt-3 h-3 w-2/3" />
    </div>
  )
}
