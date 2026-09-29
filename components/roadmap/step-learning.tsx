"use client"

import Link from "next/link"
import { useEffect, useRef } from "react"
import { Check, CircleCheck, CircleDashed, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/states"
import { StatusBadge } from "@/components/status-badge"
import type { StepTracking } from "@/lib/roadmap/tracking"

// One roadmap step's learning state and action. "Mark learning complete" records learning
// evidence; the wording never suggests the skill is verified, mastered or assessed.

export type StepLearningView = { kind: "loading" } | { kind: "hidden" } | StepTracking

export function StepLearning({
  view,
  skill,
  busy,
  error,
  focusWhenCompleted,
  onComplete,
}: {
  view: StepLearningView
  // The step's roadmap text, for accessible names.
  skill: string
  busy: boolean
  error: string | null
  // Moves focus to the completed state after the user completed this step from its button.
  focusWhenCompleted: boolean
  onComplete: () => void
}) {
  const completedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (view.kind === "completed" && focusWhenCompleted) completedRef.current?.focus()
  }, [view.kind, focusWhenCompleted])

  if (view.kind === "hidden") return null

  if (view.kind === "loading") {
    return (
      <div className="px-5 pb-4" aria-hidden="true">
        <Skeleton className="h-8 w-44 rounded-md" />
      </div>
    )
  }

  const errorLine = error ? (
    <p role="alert" className="w-full text-xs text-destructive">
      {error}
    </p>
  ) : null

  if (view.kind === "unmatched") {
    return (
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-2 px-5 pb-4 text-xs">
        <CircleDashed aria-hidden="true" className="mt-px size-4 shrink-0 text-subtle-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-muted-foreground">Learning tracking unavailable for this step</p>
          <p className="mt-0.5 leading-relaxed text-subtle-foreground">
            SkillBridge couldn&apos;t map this roadmap skill to a supported skill yet.
          </p>
        </div>
        {errorLine}
      </div>
    )
  }

  const skillLabel = view.skillName ?? skill

  if (view.kind === "completed") {
    return (
      <div
        ref={completedRef}
        tabIndex={-1}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-2xl px-5 pb-4"
      >
        <StatusBadge tone="success" icon={<CircleCheck aria-hidden="true" />}>
          Learning completed
        </StatusBadge>
        <span className="text-xs text-subtle-foreground">Learning evidence recorded for {skillLabel}</span>
        <Link
          href={`/skills/${view.skillId}`}
          className="rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          View {skillLabel} skill record
        </Link>
        {errorLine}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
      <Button
        variant="secondary"
        size="sm"
        onClick={onComplete}
        disabled={busy}
        focusableWhenDisabled
        aria-label={busy ? `Recording learning for ${skill}` : `Mark learning complete for ${skill}`}
        className={cn("h-10 w-full sm:h-9 sm:w-auto", busy && "cursor-progress opacity-70")}
      >
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
        {busy ? "Recording…" : "Mark learning complete"}
      </Button>
      <span className="text-xs text-subtle-foreground">
        Records learning evidence for {skillLabel}. It doesn&apos;t verify the skill.
      </span>
      {errorLine}
    </div>
  )
}
