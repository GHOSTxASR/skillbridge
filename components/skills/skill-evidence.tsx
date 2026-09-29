"use client"

import { useId, useState } from "react"
import { ArrowUpRight, BookOpen, ClipboardCheck, FileCheck2, FolderGit2, Link2Off, RefreshCw } from "lucide-react"
import { describeEvidence } from "@/lib/skills/view"
import { countEvidence, formatDate, type EvidenceEntry, type SafeLink } from "@/lib/skills/detail"
import { Button } from "@/components/ui/button"
import type { Part } from "@/components/skills/skill-status-panel"

// The evidence for one skill, newest first. Each item says what it is, when it was
// observed and what kind of evidence it is, using only fields the API returned. Links are
// user-supplied: only safe https links are rendered, they open in a new tab, and nothing is
// fetched or embedded.

const TYPE_ICON: Record<string, React.ElementType> = {
  project: FolderGit2,
  learning: BookOpen,
  assessment: ClipboardCheck,
}

const LONG_DESCRIPTION = 280

function ExternalLink({ link, label }: { link: SafeLink; label: string }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex max-w-full items-center gap-1.5 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {label}
      <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate text-xs font-normal text-subtle-foreground">{link.host}</span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const long = text.length > LONG_DESCRIPTION
  const shown = long && !open ? `${text.slice(0, LONG_DESCRIPTION).trimEnd()}…` : text

  return (
    <div className="mt-2">
      <p id={id} className="whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
        {shown}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={id}
          className="mt-1 rounded text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}

function EvidenceItem({ entry, last }: { entry: EvidenceEntry; last: boolean }) {
  const Icon = TYPE_ICON[entry.type] ?? FileCheck2
  const observed = formatDate(entry.observedAt)

  return (
    <li className="relative flex gap-4 pb-8 last:pb-0">
      {/* The timeline: a node per item on one vertical line. */}
      {!last && <span aria-hidden="true" className="absolute bottom-0 left-[17px] top-10 w-px bg-border-strong" />}
      <span
        aria-hidden="true"
        className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border border-border-strong bg-card text-primary"
      >
        <Icon className="size-4" />
      </span>

      <article className="min-w-0 flex-1 pt-1" aria-label={`${entry.label}: ${entry.title}`}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle-foreground">
          <span className="font-medium text-muted-foreground">{entry.label}</span>
          {observed && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Observed <time dateTime={entry.observedAt!}>{observed}</time>
              </span>
            </>
          )}
        </p>
        <h3 className="mt-1 break-words text-base font-semibold tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">
          {entry.title}
        </h3>

        {entry.score !== null && (
          <p className="mt-2 text-sm text-foreground">
            Score <span className="font-semibold tabular-nums">{entry.score}</span>
            <span className="text-muted-foreground">/100</span>
            <span className="ml-2 text-xs text-subtle-foreground">recorded by SkillBridge</span>
          </p>
        )}

        {entry.description && <Description text={entry.description} />}

        {entry.roadmapStep !== null && (
          <p className="mt-2 text-xs text-subtle-foreground">From your learning roadmap · step {entry.roadmapStep}</p>
        )}

        {(entry.source || entry.demo || entry.sourceHidden) && (
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
            {entry.source && <ExternalLink link={entry.source} label={entry.type === "project" ? "View project" : "View source"} />}
            {entry.demo && <ExternalLink link={entry.demo} label="View demo" />}
            {entry.sourceHidden && (
              <span className="inline-flex items-center gap-1.5 text-xs text-subtle-foreground">
                <Link2Off aria-hidden="true" className="size-3.5" />
                Link not shown: only secure https links are displayed
              </span>
            )}
          </div>
        )}
      </article>
    </li>
  )
}

function EvidenceSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading evidence…</span>
      <div aria-hidden="true" className="space-y-7">
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="skeleton size-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2.5 pt-1">
              <div className="skeleton h-3 w-40" />
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SkillEvidence({
  evidence,
  claimed,
  onRetry,
}: {
  evidence: Part<EvidenceEntry[]>
  // Only for the empty-state wording; null while unknown.
  claimed: boolean | null
  onRetry: () => void
}) {
  const entries = evidence.state === "ready" ? evidence.value : null

  return (
    <section aria-labelledby="skill-evidence">
      <div className="mb-5">
        <h2 id="skill-evidence" className="type-heading text-foreground">
          Evidence
        </h2>
        {entries && entries.length > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            {entries.length} evidence {entries.length === 1 ? "item" : "items"} · {describeEvidence(countEvidence(entries))}
          </p>
        )}
      </div>

      {evidence.state === "loading" ? (
        <EvidenceSkeleton />
      ) : evidence.state === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-warning/25 bg-warning-muted px-5 py-5">
          <div>
            <p className="text-sm font-medium text-foreground">Couldn&apos;t load evidence.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This doesn&apos;t mean there is none. Try again in a moment.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : entries!.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong px-5 py-7">
          <p className="type-heading text-foreground">No evidence yet</p>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground text-pretty">
            {claimed
              ? "You've listed this skill on your profile, but SkillBridge doesn't have demonstrated evidence for it yet."
              : "SkillBridge doesn't have demonstrated evidence for this skill yet."}
          </p>
        </div>
      ) : (
        <ol className="min-w-0">
          {entries!.map((entry, index) => (
            <EvidenceItem key={entry.key} entry={entry} last={index === entries!.length - 1} />
          ))}
        </ol>
      )}
    </section>
  )
}
