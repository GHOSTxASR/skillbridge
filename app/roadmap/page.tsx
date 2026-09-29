"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  ExternalLink,
  Flag,
  ListChecks,
  MapPin,
  PlayCircle,
  Sparkles,
  Target,
} from "lucide-react"

import { supabase } from "@/lib/supabase-browser"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { CountUp } from "@/components/ui/count-up"
import { Eyebrow, PageHeader } from "@/components/ui/page"
import { EmptyState, ErrorState, LoadingState, Notice, Skeleton } from "@/components/ui/states"
import { StatusBadge } from "@/components/status-badge"
import { LearningProgress, type LearningProgressView } from "@/components/roadmap/learning-progress"
import { StepLearning, type StepLearningView } from "@/components/roadmap/step-learning"
import { failureText } from "@/lib/skills/load"
import { STATUS_LABEL } from "@/lib/skills/view"
import {
  applyOutcome,
  completionBody,
  completionOutcome,
  linkTracking,
  readTrustedRoadmap,
  type TrustedRoadmap,
} from "@/lib/roadmap/tracking"

type Resource = {
  id: string
  title: string
  description: string
  type: "video" | "github" | "documentation"
  url: string
  source: string
  skill: string
  free: boolean
}

type RoadmapSkill = {
  order?: number
  phase?: string
  skill: string
  reason?: string
  prerequisite?: string
  estimatedHours?: number
  topics?: string[]
  practice?: string[]
  project?: string
  checkpoint?: string
}

type LearningResponse = {
  targetRole: string
  skills: RoadmapSkill[]
  resources: Resource[]
  totalHours?: number
  totalSkills?: number
  sources: {
    github: boolean
    youtube: boolean
    documentation: boolean
  }
  generatedAt: string
  aiSummary?: string
  aiAvailable?: boolean
}

// A step's marker state: "done" once learning is recorded for it (from the trusted roadmap
// version, never from this page's roadmap copy), otherwise "upcoming".
type StepState = "upcoming" | "active" | "done"

// The trusted completion state from GET /api/skills/roadmap.
type TrackingLoad =
  | { state: "loading" }
  | { state: "error"; status: number | null }
  | { state: "ready"; trusted: TrustedRoadmap }

// A page-level message after a completion attempt that changed more than one step.
type CompletionNotice = "stale" | "signed_out" | null

const RESOURCE_META: Record<Resource["type"], { icon: React.ElementType; label: string }> = {
  documentation: { icon: BookOpen, label: "Docs" },
  github: { icon: Code2, label: "Open source" },
  video: { icon: PlayCircle, label: "Video" },
}

function getSkillName(skill: RoadmapSkill | string) {
  return typeof skill === "string" ? skill : skill.skill
}

// Animates height by transitioning grid rows (0fr to 1fr): no measuring, no jumps.
function Collapse({ open, id, children }: { open: boolean; id: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      className="grid transition-[grid-template-rows] duration-300 ease-[var(--ease-out)]"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className={cn("min-h-0 overflow-hidden", !open && "invisible")}>{children}</div>
    </div>
  )
}

function Milestone({
  step,
  index,
  state,
  resources,
  priority,
  open,
  onToggle,
  learning,
}: {
  step: RoadmapSkill
  index: number
  state: StepState
  resources: Resource[]
  priority: boolean
  open: boolean
  onToggle: () => void
  // The step's learning state and action, shown whether or not the step is expanded.
  learning: React.ReactNode
}) {
  const panelId = `step-panel-${index}`

  return (
    <div className="reveal relative pl-14" style={{ "--i": Math.min(index, 8) } as React.CSSProperties}>
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-3 z-10 flex size-10 items-center justify-center rounded-full border text-sm font-semibold tabular-nums transition-colors",
          state === "done" && "border-success/50 bg-success-muted text-success",
          state === "active" && "border-primary/70 bg-[oklch(0.25_0.05_250)] text-primary",
          state === "upcoming" && (index === 0
            ? "border-primary/60 bg-[oklch(0.25_0.05_250)] text-primary shadow-[0_0_0_5px_oklch(0.72_0.135_250/10%)]"
            : "border-border-strong bg-background text-muted-foreground")
        )}
      >
        {state === "done" ? <Check className="size-4" /> : index + 1}
      </span>

      <div className={cn("rounded-2xl border transition-colors", open ? "border-border-strong bg-card" : "border-transparent hover:bg-surface-2/40")}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-start gap-4 rounded-2xl px-5 py-4 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h3 className="text-base font-semibold tracking-[-0.01em] text-foreground">{step.skill}</h3>
              {index === 0 && state !== "done" && <StatusBadge tone="primary">Start here</StatusBadge>}
              {priority && <StatusBadge tone="ai" icon={<Sparkles />}>Priority</StatusBadge>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">
              {typeof step.estimatedHours === "number" && <span className="tabular-nums">~{step.estimatedHours} hours</span>}
              {step.prerequisite && step.prerequisite !== "None" && <span>After {step.prerequisite}</span>}
              {resources.length > 0 && <span>{resources.length} resources</span>}
            </p>
            {!open && step.reason && (
              <p className="mt-2 line-clamp-1 max-w-2xl text-sm text-muted-foreground">{step.reason}</p>
            )}
          </div>
          <ChevronDown
            aria-hidden="true"
            className={cn("mt-1 size-5 shrink-0 text-subtle-foreground transition-transform duration-300", open && "rotate-180")}
          />
        </button>

        {learning}

        <Collapse open={open} id={panelId}>
          <div className="space-y-6 px-5 pb-6">
            {step.reason && (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{step.reason}</p>
            )}

            {Array.isArray(step.topics) && step.topics.length > 0 && (
              <div>
                <p className="type-eyebrow text-subtle-foreground">Topics</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {step.topics.map((topic, topicIndex) => (
                    <span key={`${topic}-${topicIndex}`} className="rounded-md bg-surface-2 px-2.5 py-1 text-xs text-foreground/85">
                      {topic}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(step.project || (step.practice && step.practice.length > 0) || step.checkpoint) && (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {step.practice && step.practice.length > 0 && (
                  <div>
                    <p className="type-eyebrow text-subtle-foreground">Practice</p>
                    <ul className="mt-2.5 space-y-1.5">
                      {step.practice.map((item, itemIndex) => (
                        <li key={itemIndex} className="flex gap-2 text-sm text-muted-foreground">
                          <span className="mt-2 size-1 shrink-0 rounded-full bg-subtle-foreground" aria-hidden="true" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {step.project && (
                  <div>
                    <p className="type-eyebrow text-subtle-foreground">Project</p>
                    <p className="mt-2.5 flex gap-2 text-sm text-muted-foreground">
                      <Code2 className="mt-0.5 size-4 shrink-0 text-primary" />
                      {step.project}
                    </p>
                  </div>
                )}
                {step.checkpoint && (
                  <div className="sm:col-span-2">
                    <p className="type-eyebrow text-subtle-foreground">Checkpoint</p>
                    <p className="mt-2.5 flex gap-2 text-sm text-muted-foreground">
                      <ListChecks className="mt-0.5 size-4 shrink-0 text-success" />
                      {step.checkpoint}
                    </p>
                  </div>
                )}
              </div>
            )}

            {resources.length > 0 && (
              <div>
                <p className="type-eyebrow text-subtle-foreground">Resources</p>
                <ul className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {resources.map((resource) => {
                    const meta = RESOURCE_META[resource.type] ?? RESOURCE_META.documentation
                    const Icon = meta.icon
                    return (
                      <li key={resource.id}>
                        <a
                          href={resource.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pressable group flex h-full items-start gap-3 rounded-xl border border-border bg-background/40 p-3 hover:border-border-strong hover:bg-surface-2"
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-primary">
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 text-xs font-medium text-foreground">{resource.title}</span>
                            <span className="mt-0.5 block text-[11px] text-subtle-foreground">
                              {meta.label} · {resource.source}
                            </span>
                          </span>
                          <ExternalLink className="size-3.5 shrink-0 text-subtle-foreground group-hover:text-foreground" />
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        </Collapse>
      </div>
    </div>
  )
}

function RoadmapSkeleton() {
  return (
    <div className="space-y-6 pl-14">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      ))}
    </div>
  )
}

export default function RoadmapPage() {
  const [aiPriorities, setAiPriorities] = useState<string[]>([])
  const [data, setData] = useState<LearningResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set([0]))
  const [summaryOpen, setSummaryOpen] = useState(false)

  const loadLearning = useCallback(async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Please login again.")
        return
      }

      // Priorities from this user's own saved skill-gap analysis, if there is one.
      try {
        const saved = localStorage.getItem(`skillbridge-ai-analysis-${user.id}`)
        const analysis = saved ? JSON.parse(saved) : null

        if (Array.isArray(analysis?.prioritySkills)) {
          setAiPriorities(
            analysis.prioritySkills.filter((skill: unknown): skill is string => typeof skill === "string")
          )
        }
      } catch (priorityError) {
        console.warn("Could not load AI roadmap priorities:", priorityError)
      }

      const response = await fetch("/api/learning", {
        cache: "no-store",
      })

      const result = await response.json()

      // Over the per-user AI limit: show when to try again.
      if (response.status === 429) {
        setError(
          typeof result?.message === "string"
            ? result.message
            : "You've reached the AI request limit. Please try again later."
        )
        return
      }

      if (!response.ok) {
        throw new Error(result.error || "Unable to load learning resources")
      }

      setData(result)
    } catch (err) {
      console.error("Learning page error:", err)
      setError("Unable to load your personalized learning roadmap.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadLearning()
  }, [loadLearning])

  // ---- Learning tracking (trusted roadmap version) ----
  // Read only after the roadmap request above answered, so a version recorded by that same
  // request is seen. One read per load, one more after each completion attempt; no polling.
  const [tracking, setTracking] = useState<TrackingLoad>({ state: "loading" })
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set())
  const pendingRef = useRef(new Set<number>())
  const [stepErrors, setStepErrors] = useState<Record<number, string>>({})
  const [justCompleted, setJustCompleted] = useState<number | null>(null)
  const [completionNotice, setCompletionNotice] = useState<CompletionNotice>(null)
  const [announcement, setAnnouncement] = useState("")

  const readTracking = useCallback(async (signal?: AbortSignal): Promise<TrackingLoad> => {
    try {
      const response = await fetch("/api/skills/roadmap", { cache: "no-store", signal })
      if (!response.ok) return { state: "error", status: response.status }
      const trusted = readTrustedRoadmap(await response.json().catch(() => null))
      return trusted ? { state: "ready", trusted } : { state: "error", status: null }
    } catch (err) {
      if (signal?.aborted) throw err
      return { state: "error", status: null }
    }
  }, [])

  const loadTracking = useCallback(
    async (signal?: AbortSignal) => {
      setTracking({ state: "loading" })
      try {
        const result = await readTracking(signal)
        if (!signal?.aborted) setTracking(result)
      } catch {
        // Aborted: the page moved on.
      }
    },
    [readTracking]
  )

  // After a completion attempt: one targeted re-read. The current state stays on screen while
  // it runs, and a failed re-read keeps it (the server result was already applied).
  const refreshTracking = useCallback(async () => {
    const result = await readTracking()
    if (result.state === "ready" || (result.state === "error" && result.status === 401)) setTracking(result)
  }, [readTracking])

  // Each time the roadmap itself loads (first visit, retry or reload), read tracking once.
  useEffect(() => {
    if (!data) return
    const controller = new AbortController()
    setCompletionNotice(null)
    setStepErrors({})
    setJustCompleted(null)
    setAnnouncement("")
    loadTracking(controller.signal)
    return () => controller.abort()
  }, [data, loadTracking])

  const linked = useMemo(() => {
    if (!data || tracking.state !== "ready") return null
    return linkTracking({ steps: data.skills, generatedAt: data.generatedAt, aiAvailable: data.aiAvailable }, tracking.trusted)
  }, [data, tracking])

  const completeStep = useCallback(
    async (order: number) => {
      if (!linked || linked.status !== "ready" || tracking.state !== "ready") return
      // Synchronous guard: a second click (or key press) before the first answer is ignored.
      if (pendingRef.current.has(order)) return
      pendingRef.current.add(order)
      setPending(new Set(pendingRef.current))
      setStepErrors((current) => {
        const next = { ...current }
        delete next[order]
        return next
      })
      setJustCompleted(null)
      setAnnouncement("")

      let status: number | null = null
      let body: unknown = null
      try {
        const response = await fetch("/api/skills/roadmap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: completionBody(linked.versionId, order),
        })
        status = response.status
        body = await response.json().catch(() => null)
      } catch {
        status = null
      }

      const outcome = completionOutcome(status, body)
      const setError = (message: string) => setStepErrors((current) => ({ ...current, [order]: message }))

      switch (outcome.kind) {
        case "completed": {
          setTracking((current) => (current.state === "ready" ? { ...current, trusted: applyOutcome(current.trusted, order, outcome) } : current))
          setJustCompleted(order)
          const name = outcome.skillName ?? "this skill"
          const progress = outcome.progress ? ` ${name} shows as ${STATUS_LABEL[outcome.progress]} on your Skills page.` : ""
          setAnnouncement(
            outcome.created
              ? `Learning evidence recorded for ${name}.${progress}`
              : `Learning for ${name} was already recorded.${progress}`
          )
          break
        }
        case "unmatched":
          setTracking((current) => (current.state === "ready" ? { ...current, trusted: applyOutcome(current.trusted, order, outcome) } : current))
          setAnnouncement("Learning tracking is unavailable for this step. Nothing was recorded.")
          break
        case "stale":
          setCompletionNotice("stale")
          setAnnouncement("Your roadmap has changed. Nothing was recorded.")
          break
        case "not_found":
          setError("This step isn't available anymore. Nothing was recorded.")
          break
        case "limit":
          setError("You've reached the limit of 1000 evidence records, so nothing was recorded.")
          break
        case "signed_out":
          setCompletionNotice("signed_out")
          break
        case "failed":
          setError(`Nothing was recorded. ${failureText(outcome.offline ? null : 500)}`)
          break
      }

      pendingRef.current.delete(order)
      setPending(new Set(pendingRef.current))

      // One targeted re-read reconciles with the server. Skipped after a failure (the server
      // recorded nothing, and a re-read would most likely fail too) and after a sign-out.
      if (outcome.kind !== "failed" && outcome.kind !== "signed_out") await refreshTracking()
    },
    [linked, tracking.state, refreshTracking]
  )

  const resourcesBySkill = useMemo(() => {
    if (!data) return {}

    return data.skills.reduce<Record<string, Resource[]>>((groups, roadmapSkill) => {
      const skillName = getSkillName(roadmapSkill)

      if (!skillName) return groups

      groups[skillName] = data.resources.filter(
        (resource) => String(resource.skill ?? "").toLowerCase() === skillName.toLowerCase()
      )

      return groups
    }, {})
  }, [data])

  const prioritySet = new Set(aiPriorities.map((skill) => skill.toLowerCase()))

  const header = (
    <PageHeader
      eyebrow={<Eyebrow tone="primary">Step 3 · Learn</Eyebrow>}
      title={
        data ? (
          <>
            Your learning roadmap
            <span className="block text-muted-foreground">to {data.targetRole}</span>
          </>
        ) : (
          "Your learning roadmap"
        )
      }
      description="An ordered path through the skills your target role needs, with resources for every step."
      meta={
        data ? (
          <>
            {data.aiAvailable === false ? (
              <StatusBadge tone="warning">Basic roadmap · AI unavailable</StatusBadge>
            ) : (
              <StatusBadge tone="ai" icon={<Sparkles />}>AI roadmap</StatusBadge>
            )}
            {data.aiAvailable !== false && data.generatedAt && (
              <span>Generated {new Date(data.generatedAt).toLocaleString()}</span>
            )}
          </>
        ) : undefined
      }
    />
  )

  if (loading) {
    return (
      <div>
        {header}
        <LoadingState title="Building your learning path…" description="Ordering the skills your target role needs.">
          <RoadmapSkeleton />
        </LoadingState>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        {header}
        <ErrorState
          title="Your roadmap couldn't load"
          description={error || "Please try again in a moment."}
          onRetry={loadLearning}
        />
      </div>
    )
  }

  const steps = data.skills
  const totalHours = data.totalHours ?? steps.reduce((sum, step) => sum + (step.estimatedHours ?? 0), 0)

  // Hours per phase, in the order phases first appear.
  const phases: Array<{ name: string; hours: number; count: number }> = []
  for (const step of steps) {
    const name = step.phase || "Unphased"
    const existing = phases.find((phase) => phase.name === name)
    if (existing) {
      existing.hours += step.estimatedHours ?? 0
      existing.count += 1
    } else {
      phases.push({ name, hours: step.estimatedHours ?? 0, count: 1 })
    }
  }

  const toggle = (index: number) =>
    setOpenSteps((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  const allOpen = steps.length > 0 && openSteps.size === steps.length

  const signedOut = completionNotice === "signed_out" || (tracking.state === "error" && tracking.status === 401)
  const progressView: LearningProgressView = signedOut
    ? { state: "signed_out" }
    : completionNotice === "stale"
      ? { state: "stale", onReload: loadLearning }
      : tracking.state === "loading"
        ? { state: "loading" }
        : tracking.state === "error"
          ? { state: "error", message: failureText(tracking.status), onRetry: () => loadTracking() }
          : linked?.status === "ready"
            ? { state: "ready", steps: linked.steps }
            : { state: "unavailable", reason: linked?.status === "unavailable" ? linked.reason : "mismatch", onReload: loadLearning }

  // Steps offer completion only while the page shows the latest trusted version.
  const stepView = (index: number): StepLearningView => {
    if (tracking.state === "loading") return { kind: "loading" }
    if (signedOut || completionNotice === "stale" || linked?.status !== "ready") return { kind: "hidden" }
    return linked.steps[index] ?? { kind: "hidden" }
  }

  return (
    <div>
      {header}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {data.aiAvailable === false && (
        <Notice tone="warning" title="This is a basic roadmap" className="mb-10">
          AI recommendations are temporarily unavailable, so a general starting roadmap is
          shown. Your personalized roadmap appears when AI is available again.
        </Notice>
      )}

      {data.aiSummary && (
        <blockquote className="mb-14 max-w-3xl border-l-2 border-ai/50 pl-5">
          <Eyebrow tone="ai">
            <Sparkles className="size-3" />
            Learning advisor
          </Eyebrow>
          <p
            className={cn(
              "mt-2.5 text-base leading-relaxed text-foreground/85 text-pretty",
              !summaryOpen && data.aiSummary.length > 280 && "line-clamp-3"
            )}
          >
            {data.aiSummary}
          </p>
          {data.aiSummary.length > 280 && (
            <button
              type="button"
              onClick={() => setSummaryOpen((open) => !open)}
              aria-expanded={summaryOpen}
              className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {summaryOpen ? "Show less" : "Read more"}
            </button>
          )}
        </blockquote>
      )}

      {steps.length === 0 ? (
        <EmptyState
          title="No roadmap steps yet"
          description="Complete your skill assessment so SkillBridge can build a path for your target role."
          action={
            <Link href="/assessment" className={buttonVariants({ size: "sm" })}>
              Go to assessment
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-14 xl:grid-cols-[minmax(0,1fr)_280px]">
          {/* Journey */}
          <div className="min-w-0">
            <LearningProgress view={progressView} className="mb-8" />

            <div className="mb-6 flex items-center justify-between gap-4">
              <p className="text-xs text-subtle-foreground">Steps are shown in recommended order.</p>
              <button
                type="button"
                onClick={() => setOpenSteps(allOpen ? new Set() : new Set(steps.map((_, index) => index)))}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-surface-2"
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            </div>

            <div className="relative">
              <span
                aria-hidden="true"
                className="grow-y absolute bottom-10 left-[19px] top-6 w-px bg-[linear-gradient(to_bottom,var(--primary),var(--ai)_70%,oklch(0.82_0.11_192/40%))]"
              />

              <div className="relative mb-6 flex items-center gap-4 pl-0">
                <span className="relative z-10 flex size-10 items-center justify-center rounded-full border border-border-strong bg-background text-muted-foreground">
                  <MapPin className="size-4" />
                </span>
                <p className="text-sm text-muted-foreground">You are here</p>
              </div>

              <ol className="space-y-3">
                {steps.map((step, index) => {
                  const skillName = getSkillName(step)
                  const previousPhase = index > 0 ? steps[index - 1].phase : undefined
                  const showPhase = step.phase && step.phase !== previousPhase
                  const view = stepView(index)
                  const order = "order" in view ? view.order : null

                  return (
                    <li key={`${skillName}-${index}`} className="list-none">
                      {showPhase && (
                        <p className={cn("type-eyebrow mb-3 pl-14 text-subtle-foreground", index === 0 ? "mt-0" : "mt-8")}>
                          {step.phase}
                        </p>
                      )}
                      <Milestone
                        step={step}
                        index={index}
                        state={view.kind === "completed" ? "done" : "upcoming"}
                        resources={resourcesBySkill[skillName] ?? []}
                        priority={prioritySet.has(skillName.toLowerCase())}
                        open={openSteps.has(index)}
                        onToggle={() => toggle(index)}
                        learning={
                          <StepLearning
                            view={view}
                            skill={skillName}
                            busy={order !== null && pending.has(order)}
                            error={order !== null ? stepErrors[order] ?? null : null}
                            focusWhenCompleted={order !== null && justCompleted === order}
                            onComplete={() => {
                              if (order !== null) void completeStep(order)
                            }}
                          />
                        }
                      />
                    </li>
                  )
                })}
              </ol>

              <div className="relative mt-6 flex items-center gap-4">
                <span
                  className="relative z-10 flex size-10 items-center justify-center rounded-full text-primary-foreground"
                  style={{ background: "var(--brand-gradient)" }}
                >
                  <Flag className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{data.targetRole}</p>
                  <p className="text-xs text-subtle-foreground">Your destination</p>
                </div>
              </div>
            </div>
          </div>

          {/* Overview rail */}
          <aside className="xl:sticky xl:top-10 xl:self-start">
            <div className="surface p-5">
              <p className="type-eyebrow text-subtle-foreground">Overview</p>
              <dl className="mt-4 grid grid-cols-3 gap-4 xl:grid-cols-1 xl:gap-5">
                <div>
                  <dt className="text-xs text-subtle-foreground">Estimated time</dt>
                  <dd className="type-metric mt-1.5 text-2xl text-foreground">
                    <CountUp value={totalHours} />
                    <span className="ml-1 text-sm font-medium tracking-normal text-muted-foreground">hours</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-subtle-foreground">Skills</dt>
                  <dd className="type-metric mt-1.5 text-2xl text-foreground">{steps.length}</dd>
                </div>
                <div>
                  <dt className="text-xs text-subtle-foreground">Resources</dt>
                  <dd className="type-metric mt-1.5 text-2xl text-foreground">{data.resources.length}</dd>
                </div>
              </dl>

              {phases.length > 1 && (
                <div className="mt-6 border-t border-border pt-5">
                  <p className="type-eyebrow text-subtle-foreground">Time by phase</p>
                  <ul className="mt-3 space-y-3">
                    {phases.map((phase) => (
                      <li key={phase.name}>
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="truncate text-muted-foreground">{phase.name}</span>
                          <span className="tabular-nums text-subtle-foreground">{phase.hours} h</span>
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[oklch(1_0_0/7%)]">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${totalHours ? (phase.hours / totalHours) * 100 : 0}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6 border-t border-border pt-5">
                <p className="flex items-start gap-2 text-xs leading-relaxed text-subtle-foreground">
                  <Target className="mt-0.5 size-3.5 shrink-0" />
                  Resources link to official documentation and to GitHub and YouTube searches
                  for each skill.
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
