"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import {
  ArrowRight,
  ChevronDown,
  ClipboardCheck,
  Code2,
  RefreshCw,
  Route,
  Sparkles,
} from "lucide-react"

import { supabase } from "@/lib/supabase-browser"
import { cn } from "@/lib/utils"
import {
  LEVEL_META,
  countByLevel,
  requiredSkills,
  type RequiredSkill,
  type SkillLevel,
} from "@/lib/skill-status"
import { buttonVariants } from "@/components/ui/button"
import { ReadinessGauge } from "@/components/ui/gauge"
import { Eyebrow, PageHeader, Section } from "@/components/ui/page"
import { ErrorState, LoadingState, Notice, Skeleton } from "@/components/ui/states"
import { StatusBadge } from "@/components/status-badge"

type SkillGap = {
  skill: string
  category?: string
  currentLevel?: number
  requiredLevel?: number
  status?: string
  priority?: "high" | "medium" | "low"
  reason?: string
}

type RoadmapItem = {
  order: number
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

type Analysis = {
  targetRole?: string
  readiness?: number
  summary?: string
  strengths?: string[]
  gaps?: string[]
  missingSkills?: string[]
  weakSkills?: string[]
  prioritySkills?: string[]
  skillGaps?: SkillGap[]
  roadmap?: RoadmapItem[]
  jobFit?: {
    score?: number
    explanation?: string
  }
  aiAvailable?: boolean
  reason?: string
  cached?: boolean
  generatedAt?: string
}

const COLUMN_ORDER: SkillLevel[] = ["strong", "developing", "missing"]

const COLUMN_TEXT: Record<SkillLevel, string> = {
  strong: "Already solid for this role",
  developing: "Some foundation; worth strengthening",
  missing: "Not in your profile yet",
}

// The share of skills at each level, as one bar. Widths come straight from the counts.
function CompositionBar({ counts }: { counts: Record<SkillLevel, number> }) {
  const total = counts.strong + counts.developing + counts.missing
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  if (total === 0) return null

  return (
    <div>
      <div
        className="flex h-3 w-full gap-1 overflow-hidden rounded-full"
        role="img"
        aria-label={`${counts.strong} strong, ${counts.developing} developing and ${counts.missing} missing skills`}
      >
        {COLUMN_ORDER.map((level) =>
          counts[level] > 0 ? (
            <div
              key={level}
              className={cn("h-full rounded-full", LEVEL_META[level].bar)}
              style={{
                width: drawn ? `${(counts[level] / total) * 100}%` : "0%",
                transition: "width 900ms var(--ease-out)",
              }}
            />
          ) : null
        )}
      </div>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        {COLUMN_ORDER.map((level) => (
          <div key={level} className="flex items-baseline gap-2">
            <span className={cn("size-2 self-center rounded-full", LEVEL_META[level].dot)} aria-hidden="true" />
            <dt className="text-sm text-muted-foreground">{LEVEL_META[level].label}</dt>
            <dd className="type-metric text-lg text-foreground">{counts[level]}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SkillItem({ entry }: { entry: RequiredSkill }) {
  const detail = entry.reason || entry.priority

  if (!detail) {
    return (
      <li className="flex items-center gap-3 py-3">
        <span className={cn("size-1.5 shrink-0 rounded-full", LEVEL_META[entry.level].dot)} aria-hidden="true" />
        <span className="text-sm text-foreground">{entry.skill}</span>
      </li>
    )
  }

  return (
    <li>
      <details className="group py-1">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg py-2 marker:hidden [&::-webkit-details-marker]:hidden">
          <span className={cn("size-1.5 shrink-0 rounded-full", LEVEL_META[entry.level].dot)} aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm text-foreground">{entry.skill}</span>
          {entry.priority === "high" && entry.level !== "strong" && (
            <StatusBadge tone="danger">High</StatusBadge>
          )}
          <ChevronDown className="size-4 shrink-0 text-subtle-foreground transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <div className="pb-3 pl-[18px] pr-6">
          {entry.priority && (
            <p className="type-eyebrow text-subtle-foreground">{entry.priority} priority</p>
          )}
          {entry.reason && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{entry.reason}</p>
          )}
        </div>
      </details>
    </li>
  )
}

function AnalysisSkeleton() {
  return (
    <div className="mt-2 space-y-12">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[auto_1fr] lg:items-center">
        <Skeleton className="size-44 rounded-full" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-6 h-3 w-full rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function GapAnalysisPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [limitNotice, setLimitNotice] = useState("")

  // A normal visit uses the saved analysis when it still matches the profile; only the
  // explicit "Refresh analysis" button asks the server for a new one (?refresh=1).
  const loadAnalysis = useCallback(async (refresh: boolean) => {
    try {
      // A refresh keeps the current analysis on screen while the new one is prepared.
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError("")
      setLimitNotice("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        window.location.href = "/login"
        return
      }

      // The server analyzes the saved profile (the canonical career target, which the
      // assessment saves into), so nothing about the profile is sent from here.
      const response = await fetch(refresh ? "/api/ai/career-analysis?refresh=1" : "/api/ai/career-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({}),
      })

      const result = await response.json()

      // Over the per-user AI limit. A refused refresh keeps the analysis on screen (the
      // Refresh button only shows with one); a first load has nothing else to show.
      if (response.status === 429) {
        const message =
          typeof result?.message === "string"
            ? result.message
            : "You've reached the AI request limit. Please try again later."

        if (refresh) {
          setLimitNotice(message)
          return
        }

        throw new Error(message)
      }

      if (!response.ok) {
        throw new Error(result?.error || "Unable to generate AI skill gap analysis")
      }

      const aiResult: Analysis = result

      setAnalysis(aiResult)

      // Only a genuine AI analysis is kept for the dashboard; an estimate shown while
      // AI is unavailable never replaces the last real one.
      if (aiResult.aiAvailable === true) {
        localStorage.setItem(
          `skillbridge-ai-analysis-${user.id}`,
          JSON.stringify({
            ...aiResult,
            savedAt: aiResult.generatedAt ?? new Date().toISOString(),
          })
        )
      }
    } catch (err) {
      console.error("AI skill gap analysis error:", err)
      setError(err instanceof Error ? err.message : "Unable to generate your AI skill gap analysis.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadAnalysis(false)
  }, [loadAnalysis])

  const header = (extra?: Partial<React.ComponentProps<typeof PageHeader>>) => (
    <PageHeader
      eyebrow={<Eyebrow tone="primary">Step 2 · Understand</Eyebrow>}
      title="Skill gap analysis"
      description="How your skills compare with what your target role needs, and what to focus on first."
      {...extra}
    />
  )

  if (loading) {
    return (
      <div>
        {header()}
        <LoadingState
          title="Analyzing your skill profile…"
          description="Comparing your saved skills with your target role's requirements."
        >
          <AnalysisSkeleton />
        </LoadingState>
      </div>
    )
  }

  if (error || !analysis) {
    return (
      <div>
        {header()}
        <ErrorState
          title="Your analysis couldn't be generated"
          description={error || "Complete your assessment, then try again."}
          onRetry={() => loadAnalysis(false)}
          action={
            <Link href="/assessment" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <ClipboardCheck />
              Review assessment
            </Link>
          }
        />
      </div>
    )
  }

  const targetRole = analysis.targetRole || "your target role"
  const readiness = Math.max(0, Math.min(100, Math.round(analysis.readiness ?? 0)))

  const skills = requiredSkills(analysis)
  const counts = countByLevel(skills)
  const byLevel = (level: SkillLevel) => skills.filter((entry) => entry.level === level)

  const prioritySkills = Array.isArray(analysis.prioritySkills) ? analysis.prioritySkills : []
  const roadmap = Array.isArray(analysis.roadmap) ? analysis.roadmap : []

  const lookup = new Map(skills.map((entry) => [entry.skill.toLowerCase(), entry]))

  const isEstimate = analysis.aiAvailable === false
  const jobFitScore = typeof analysis.jobFit?.score === "number" ? Math.round(analysis.jobFit.score) : null

  return (
    <div className={cn("transition-opacity duration-300", refreshing && "opacity-60")} aria-busy={refreshing}>
      {header({
        title: (
          <>
            Skill gap analysis
            <span className="block text-muted-foreground">for {targetRole}</span>
          </>
        ),
        meta: (
          <>
            {isEstimate ? (
              <StatusBadge tone="warning">Estimate · AI unavailable</StatusBadge>
            ) : (
              <StatusBadge tone="ai" icon={<Sparkles />}>AI analysis</StatusBadge>
            )}
            {analysis.aiAvailable === true && analysis.generatedAt && (
              <span>Analyzed {new Date(analysis.generatedAt).toLocaleString()}</span>
            )}
          </>
        ),
        actions: (
          <>
            <button
              type="button"
              onClick={() => loadAnalysis(true)}
              disabled={refreshing}
              className={buttonVariants({ variant: "secondary" })}
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              {refreshing ? "Refreshing…" : "Refresh analysis"}
            </button>
            <Link href="/roadmap" className={buttonVariants()}>
              Learning roadmap
              <ArrowRight />
            </Link>
          </>
        ),
      })}

      <div className="space-y-4">
        {isEstimate && (
          <Notice tone="warning" title="This is an estimate, not an AI analysis">
            {analysis.reason === "rate_limited"
              ? "AI analysis is temporarily unavailable (too many requests right now), so this is an estimate from your saved skills. Try again in a minute."
              : "AI analysis is temporarily unavailable, so this is an estimate from your saved skills."}
          </Notice>
        )}
        {analysis.aiAvailable === true && analysis.reason && (
          <Notice tone="info">
            The analysis could not be refreshed right now, so your last saved analysis is shown.
          </Notice>
        )}
        {limitNotice && (
          <Notice tone="warning">
            {limitNotice} Your last analysis is still shown.
          </Notice>
        )}
      </div>

      <div className="mt-12 space-y-20">
        {/* ------------------------------------------------------ Position */}
        <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[auto_1fr] lg:gap-16" aria-labelledby="position-title">
          <h2 id="position-title" className="sr-only">Where you stand</h2>
          <div className="flex flex-col items-center gap-3">
            <ReadinessGauge value={readiness} size={200} label="ready" />
            <p className="max-w-[15rem] text-center text-xs text-subtle-foreground">
              {isEstimate ? "Estimated from your saved skills" : `AI estimate of your readiness for ${targetRole}`}
            </p>
          </div>

          <div className="min-w-0">
            <Eyebrow tone={isEstimate ? "muted" : "ai"}>
              {!isEstimate && <Sparkles className="size-3" />}
              Where you stand
            </Eyebrow>
            <p className="mt-3 max-w-3xl text-lg leading-relaxed text-foreground/90 text-pretty">
              {analysis.summary || `Your current profile was compared with the requirements for ${targetRole}.`}
            </p>

            <div className="mt-8 max-w-3xl">
              <p className="mb-3 text-xs text-subtle-foreground">
                {skills.length} skills this analysis covers for {targetRole}
              </p>
              <CompositionBar counts={counts} />
            </div>

            {analysis.jobFit?.explanation && (
              <p className="mt-8 max-w-3xl border-l-2 border-border-strong pl-4 text-sm leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">
                  Role fit{jobFitScore !== null && jobFitScore !== readiness ? ` · ${jobFitScore}%` : ""}:{" "}
                </span>
                {analysis.jobFit.explanation}
              </p>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------ Skill map */}
        <Section
          title="Skill map"
          description="Every skill in the analysis, by level. Open a skill to see why it matters."
          divider
        >
          <p className="-mt-2 mb-6 text-xs text-subtle-foreground">
            Levels are categories from the AI analysis, not measured test scores.
          </p>
          <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
            {COLUMN_ORDER.map((level) => {
              const entries = byLevel(level)
              return (
                <div key={level} className="min-w-0">
                  <div className="flex items-center gap-2 border-b border-border pb-3">
                    <span className={cn("size-2 rounded-full", LEVEL_META[level].dot)} aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-foreground">{LEVEL_META[level].label}</h3>
                    <span className="ml-auto text-sm tabular-nums text-subtle-foreground">{entries.length}</span>
                  </div>
                  <p className="mt-2 text-xs text-subtle-foreground">{COLUMN_TEXT[level]}</p>
                  {entries.length === 0 ? (
                    <p className="mt-4 text-sm text-subtle-foreground">None</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-border">
                      {entries.map((entry) => (
                        <SkillItem key={entry.skill} entry={entry} />
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </Section>

        {/* ------------------------------------------------------ Priorities */}
        {prioritySkills.length > 0 && (
          <Section
            title="Focus on these first"
            description="The skills the analysis ranks as most important to learn next."
            divider
          >
            <ol className="grid grid-cols-1 gap-x-10 gap-y-2 md:grid-cols-2">
              {prioritySkills.map((skill, index) => {
                const entry = lookup.get(skill.toLowerCase())
                return (
                  <li
                    key={`${skill}-${index}`}
                    className="reveal flex gap-5 border-b border-border py-5"
                    style={{ "--i": index } as React.CSSProperties}
                  >
                    <span className="type-metric w-8 shrink-0 text-2xl text-subtle-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-medium text-foreground">{skill}</p>
                        {entry && (
                          <span className={cn("text-xs", LEVEL_META[entry.level].text)}>
                            {LEVEL_META[entry.level].label}
                          </span>
                        )}
                      </div>
                      {entry?.reason && (
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{entry.reason}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Section>
        )}

        {/* ------------------------------------------------------ Sequence */}
        {roadmap.length > 0 && (
          <Section
            title="Suggested sequence"
            description="The order this analysis recommends. Your learning roadmap builds a detailed plan with resources."
            action={
              <Link href="/roadmap" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                <Route />
                Full roadmap
              </Link>
            }
            divider
          >
            <ol className="relative">
              <span aria-hidden="true" className="grow-y absolute bottom-6 left-[19px] top-6 w-px bg-[linear-gradient(to_bottom,var(--ai),var(--primary),oklch(1_0_0/8%))]" />
              {roadmap.slice(0, 8).map((item, index) => (
                <li
                  key={`${item.skill}-${index}`}
                  className="reveal relative flex gap-5 pb-8 last:pb-0"
                  style={{ "--i": index } as React.CSSProperties}
                >
                  <span className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border border-border-strong bg-background text-sm font-semibold tabular-nums text-foreground">
                    {item.order || index + 1}
                  </span>
                  <div className="min-w-0 flex-1 pt-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="text-base font-medium text-foreground">{item.skill}</h3>
                      {item.phase && <StatusBadge>{item.phase}</StatusBadge>}
                      {item.estimatedHours ? (
                        <span className="text-xs tabular-nums text-subtle-foreground">~{item.estimatedHours} h</span>
                      ) : null}
                    </div>
                    {item.reason && (
                      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{item.reason}</p>
                    )}
                    {Array.isArray(item.topics) && item.topics.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.topics.slice(0, 5).map((topic) => (
                          <span key={topic} className="rounded-md bg-surface-2 px-2 py-1 text-[11px] text-muted-foreground">
                            {topic}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.project && (
                      <p className="mt-3 flex max-w-3xl items-start gap-2 text-sm text-muted-foreground">
                        <Code2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        <span>
                          <span className="font-medium text-foreground">Project: </span>
                          {item.project}
                        </span>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        )}
      </div>
    </div>
  )
}
