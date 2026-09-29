import Link from "next/link"
import { Info, LogIn, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { Notice, Skeleton } from "@/components/ui/states"
import { trackingSummary, type RoadmapTracking, type StepTracking } from "@/lib/roadmap/tracking"

// The roadmap's learning-progress summary: how many steps have learning recorded. It is
// roadmap progress only, never a mastery, confidence or readiness figure.

export type LearningProgressView =
  | { state: "loading" }
  | { state: "error"; message: string; onRetry: () => void }
  | { state: "signed_out" }
  // A completion was refused because a newer roadmap version exists (409).
  | { state: "stale"; onReload: () => void }
  | { state: "unavailable"; reason: Extract<RoadmapTracking, { status: "unavailable" }>["reason"]; onReload: () => void }
  | { state: "ready"; steps: StepTracking[] }

const SEGMENT: Record<StepTracking["kind"], string> = {
  completed: "bg-success",
  available: "bg-[oklch(1_0_0/12%)]",
  unmatched: "bg-[repeating-linear-gradient(90deg,oklch(1_0_0/16%)_0_3px,transparent_3px_6px)]",
}

const UNAVAILABLE = {
  no_version: {
    title: "Learning tracking starts with your next roadmap",
    body: "This roadmap was generated before SkillBridge could record learning steps. Tracking turns on the next time your roadmap is generated, for example after you change your profile skills or target role.",
  },
  basic: {
    title: "Learning tracking is available on your personalized roadmap",
    body: "Steps from the basic roadmap can't be recorded. They can be once your AI roadmap is available again.",
  },
  mismatch: {
    title: "Learning steps can't be recorded right now",
    body: "SkillBridge couldn't confirm that this is your latest roadmap. Reload it to see the current steps.",
  },
} as const

export function LearningProgress({ view, className }: { view: LearningProgressView; className?: string }) {
  if (view.state === "loading") {
    return (
      <div role="status" aria-live="polite" className={cn("surface p-5", className)}>
        <span className="sr-only">Loading your learning progress…</span>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-5 w-60 max-w-full" />
        <Skeleton className="mt-5 h-1.5 w-full" />
      </div>
    )
  }

  if (view.state === "error") {
    return (
      <Notice
        tone="danger"
        title="Learning progress couldn't load"
        className={className}
        action={
          <Button variant="secondary" size="xs" onClick={view.onRetry}>
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
        }
      >
        {view.message}
      </Notice>
    )
  }

  if (view.state === "signed_out") {
    return (
      <Notice
        tone="warning"
        title="You're signed out"
        className={className}
        action={
          <Link href="/login" className={buttonVariants({ variant: "secondary", size: "xs" })}>
            <LogIn aria-hidden="true" />
            Sign in
          </Link>
        }
      >
        Sign in again to record learning steps.
      </Notice>
    )
  }

  if (view.state === "stale") {
    return (
      <Notice
        tone="warning"
        title="Your roadmap has changed"
        className={className}
        action={
          <Button variant="secondary" size="xs" onClick={view.onReload}>
            <RefreshCw aria-hidden="true" />
            Reload roadmap
          </Button>
        }
      >
        A newer version of your roadmap was generated, so nothing was recorded. Reload to see
        the current steps.
      </Notice>
    )
  }

  if (view.state === "unavailable") {
    const copy = UNAVAILABLE[view.reason]
    return (
      <Notice
        tone="info"
        title={copy.title}
        className={className}
        action={
          view.reason === "mismatch" ? (
            <Button variant="secondary" size="xs" onClick={view.onReload}>
              <RefreshCw aria-hidden="true" />
              Reload
            </Button>
          ) : undefined
        }
      >
        {copy.body}
      </Notice>
    )
  }

  const summary = trackingSummary(view.steps)
  const legend = [
    { kind: "completed" as const, label: "completed", count: summary.completed },
    { kind: "available" as const, label: "ready to record", count: summary.trackable - summary.completed },
    { kind: "unmatched" as const, label: "can't be tracked yet", count: summary.unmatched },
  ].filter((item) => item.count > 0)

  return (
    <section aria-labelledby="learning-progress-title" className={cn("surface p-5", className)}>
      <p id="learning-progress-title" className="type-eyebrow text-subtle-foreground">
        Learning progress
      </p>
      <p className="mt-2 text-lg font-semibold tracking-[-0.01em] text-foreground text-pretty">{summary.headline}</p>
      {summary.detail && <p className="mt-1 text-xs text-subtle-foreground">{summary.detail}</p>}

      <div
        role="progressbar"
        aria-labelledby="learning-progress-title"
        aria-valuemin={0}
        aria-valuemax={summary.total}
        aria-valuenow={summary.completed}
        aria-valuetext={summary.headline}
        className="mt-4 flex gap-1"
      >
        {view.steps.map((step) => (
          <span key={step.order} className={cn("h-1.5 min-w-0 flex-1 rounded-full", SEGMENT[step.kind])} />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {legend.map((item) => (
          <li key={item.kind} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("h-1.5 w-3 rounded-full", SEGMENT[item.kind])} />
            <span className="tabular-nums">{item.count}</span> {item.label}
          </li>
        ))}
      </ul>

      <p className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-xs leading-relaxed text-subtle-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        Marking a step complete records learning evidence on your Skills page. It doesn&apos;t verify or
        assess the skill, and it doesn&apos;t change your readiness.
      </p>
    </section>
  )
}
