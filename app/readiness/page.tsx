"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ArrowRight, BriefcaseBusiness, ClipboardCheck, Route, ScanSearch, Sparkles } from "lucide-react"

import { supabase } from "@/lib/supabase-browser"
import { cn } from "@/lib/utils"
import {
  LEVEL_META,
  countByLevel,
  requiredSkills,
  sortByUrgency,
} from "@/lib/skill-status"
import { buttonVariants } from "@/components/ui/button"
import { CountUp } from "@/components/ui/count-up"
import { Eyebrow, PageHeader, Section } from "@/components/ui/page"
import { ErrorState, LoadingState, Notice, Skeleton } from "@/components/ui/states"
import { StatusBadge } from "@/components/status-badge"

// Readiness for the target role, from the same skill-gap analysis the Gap analysis
// page shows (a cache hit when nothing changed). Nothing here is sample data.

type Analysis = {
  targetRole?: string
  readiness?: number
  summary?: string
  strengths?: string[]
  gaps?: string[]
  missingSkills?: string[]
  weakSkills?: string[]
  prioritySkills?: string[]
  skillGaps?: Array<{ skill: string; status?: string; priority?: "high" | "medium" | "low"; reason?: string }>
  jobFit?: { score?: number; explanation?: string }
  aiAvailable?: boolean
  reason?: string
  generatedAt?: string
}

function ReadinessSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-14 w-40" />
      <Skeleton className="h-2 w-full rounded-full" />
      <div className="space-y-3 pt-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  )
}

// One comparison bar: what the role needs (always a full track) against what the
// analysis says you have (filled by category, not by a measured score).
function LevelBar({ fill, className, tone }: { fill: number; className?: string; tone: string }) {
  const [drawn, setDrawn] = useState(0)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(fill))
    return () => cancelAnimationFrame(frame)
  }, [fill])

  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-[oklch(1_0_0/7%)]", className)}>
      <div
        className={cn("h-full rounded-full", tone)}
        style={{ width: `${drawn * 100}%`, transition: "width 900ms var(--ease-out)" }}
      />
    </div>
  )
}

export default function ReadinessPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [analysis, setAnalysis] = useState<Analysis | null>(null)

  const loadAnalysis = useCallback(async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        window.location.href = "/login"
        return
      }

      // Same request as the Gap analysis page; the server uses the saved profile.
      const response = await fetch("/api/ai/career-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({}),
      })

      const result = await response.json()

      if (response.status === 429) {
        throw new Error(
          typeof result?.message === "string"
            ? result.message
            : "You've reached the AI request limit. Please try again later."
        )
      }

      if (!response.ok) {
        throw new Error(result?.error || "Unable to load your readiness")
      }

      setAnalysis(result)

      // Keep the dashboard's copy current, exactly as the Gap analysis page does.
      if (result?.aiAvailable === true) {
        localStorage.setItem(
          `skillbridge-ai-analysis-${user.id}`,
          JSON.stringify({ ...result, savedAt: result.generatedAt ?? new Date().toISOString() })
        )
      }
    } catch (err) {
      console.error("Readiness error:", err)
      setError(err instanceof Error ? err.message : "Unable to load your readiness.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAnalysis()
  }, [loadAnalysis])

  const role = analysis?.targetRole || "your target role"

  const header = (
    <PageHeader
      eyebrow={<Eyebrow tone="primary">Step 5 · Check</Eyebrow>}
      title={
        analysis ? (
          <>
            Readiness
            <span className="block text-muted-foreground">for {role}</span>
          </>
        ) : (
          "Readiness"
        )
      }
      description="What your target role requires, next to the skills you have."
      meta={
        analysis ? (
          <>
            {analysis.aiAvailable === false ? (
              <StatusBadge tone="warning">Estimate · AI unavailable</StatusBadge>
            ) : (
              <StatusBadge tone="ai" icon={<Sparkles />}>From your AI analysis</StatusBadge>
            )}
            {analysis.aiAvailable === true && analysis.generatedAt && (
              <span>Analyzed {new Date(analysis.generatedAt).toLocaleString()}</span>
            )}
          </>
        ) : undefined
      }
      actions={
        analysis && (
          <Link href="/gap-analysis" className={buttonVariants({ variant: "secondary" })}>
            <ScanSearch />
            Full analysis
          </Link>
        )
      }
    />
  )

  if (loading) {
    return (
      <div>
        {header}
        <LoadingState title="Checking your readiness…" description="Loading your latest skill gap analysis.">
          <ReadinessSkeleton />
        </LoadingState>
      </div>
    )
  }

  if (error || !analysis) {
    return (
      <div>
        {header}
        <ErrorState
          title="Your readiness couldn't load"
          description={error || "Complete your assessment, then try again."}
          onRetry={loadAnalysis}
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

  const readiness = Math.max(0, Math.min(100, Math.round(analysis.readiness ?? 0)))
  const skills = sortByUrgency(requiredSkills(analysis))
  const counts = countByLevel(skills)
  const lookup = new Map(skills.map((entry) => [entry.skill.toLowerCase(), entry]))

  const mainGaps = (Array.isArray(analysis.prioritySkills) ? analysis.prioritySkills : [])
    .map((skill) => lookup.get(skill.toLowerCase()) ?? { skill, level: "missing" as const })
    .filter((entry) => entry.level !== "strong")
    .slice(0, 3)

  const firstGap = mainGaps[0]

  return (
    <div>
      {header}

      {analysis.aiAvailable === false && (
        <Notice tone="warning" title="This is an estimate, not an AI analysis" className="mb-10">
          AI analysis is temporarily unavailable, so this readiness is estimated from your saved skills.
        </Notice>
      )}

      {/* Summary */}
      <section className="grid grid-cols-1 gap-10 border-b border-border pb-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-16">
        <div>
          <p className="type-eyebrow text-subtle-foreground">Estimated readiness</p>
          <p className="type-metric mt-3 text-7xl text-foreground">
            <CountUp value={readiness} />
            <span className="text-3xl text-muted-foreground">%</span>
          </p>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-[oklch(1_0_0/7%)]">
            <div className="h-full rounded-full" style={{ width: `${readiness}%`, background: "var(--brand-gradient)", transition: "width 900ms var(--ease-out)" }} />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{counts.strong}</span> of {skills.length} required
            skills are strong · <span className="text-warning">{counts.developing} developing</span> ·{" "}
            <span className="text-destructive">{counts.missing} missing</span>
          </p>
          <p className="mt-2 text-xs text-subtle-foreground">
            Measured against your target role, not a specific job listing.
          </p>
        </div>

        <div className="min-w-0">
          {analysis.jobFit?.explanation && (
            <>
              <Eyebrow tone="ai">
                <Sparkles className="size-3" />
                Why
              </Eyebrow>
              <p className="mt-3 text-lg leading-relaxed text-foreground/90 text-pretty">
                {analysis.jobFit.explanation}
              </p>
            </>
          )}
          {analysis.summary && (
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{analysis.summary}</p>
          )}
        </div>
      </section>

      <div className="mt-14 grid grid-cols-1 gap-16 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:gap-14">
        {/* Comparison */}
        <Section
          title="Requirements vs you"
          description={`Every skill the analysis lists for ${role}, most urgent first.`}
        >
          <div className="mb-3 hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem] items-center gap-4 px-1 text-xs text-subtle-foreground sm:grid">
            <span>Skill</span>
            <span>Role needs</span>
            <span>You</span>
            <span className="text-right">Status</span>
          </div>
          <ul className="divide-y divide-border border-y border-border">
            {skills.map((entry, index) => {
              const meta = LEVEL_META[entry.level]
              return (
                <li
                  key={entry.skill}
                  className="reveal grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-4 gap-y-2 px-1 py-3.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem]"
                  style={{ "--i": Math.min(index, 10) } as React.CSSProperties}
                >
                  <span className="truncate text-sm font-medium text-foreground">{entry.skill}</span>
                  <LevelBar fill={1} tone="bg-[oklch(1_0_0/28%)]" className="hidden sm:block" />
                  <LevelBar
                    fill={entry.level === "missing" ? 0.04 : meta.fill}
                    tone={meta.bar}
                    className={cn("col-span-2 sm:col-span-1", entry.level === "missing" && "ring-1 ring-inset ring-destructive/40")}
                  />
                  <span className={cn("row-start-1 text-right text-xs sm:row-auto", meta.text)}>{meta.label}</span>
                </li>
              )
            })}
          </ul>
          <p className="mt-4 text-xs text-subtle-foreground">
            Bars show the AI analysis&apos;s categories (strong, developing, missing), not measured test scores.
          </p>
        </Section>

        <div className="space-y-14">
          {/* Main gaps */}
          <Section title="Your main gaps" description="What stands between you and the role, in priority order.">
            {mainGaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">The analysis found no priority gaps.</p>
            ) : (
              <ol className="space-y-5">
                {mainGaps.map((entry, index) => (
                  <li key={entry.skill} className="reveal flex gap-4" style={{ "--i": index } as React.CSSProperties}>
                    <span className="type-metric w-7 shrink-0 text-2xl text-subtle-foreground">{index + 1}</span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-base font-medium text-foreground">
                        {entry.skill}
                        <span className={cn("text-xs font-normal", LEVEL_META[entry.level].text)}>
                          {LEVEL_META[entry.level].label}
                        </span>
                      </p>
                      {"reason" in entry && entry.reason && (
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{entry.reason}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {/* Next action */}
          <section
            className="relative overflow-hidden rounded-2xl p-px"
            style={{ background: "linear-gradient(140deg, oklch(0.72 0.135 250 / 45%), oklch(0.82 0.11 192 / 22%) 55%, oklch(1 0 0 / 6%))" }}
          >
            <div className="rounded-[calc(var(--radius-2xl)-1px)] bg-[oklch(0.175_0.018_255)] p-6">
              <Eyebrow tone="primary">Next action</Eyebrow>
              <p className="mt-2 text-xl font-semibold tracking-[-0.015em] text-foreground">
                {firstGap ? `Close your ${firstGap.skill} gap` : "Keep building on your strengths"}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {firstGap
                  ? "Your learning roadmap orders the skills to learn, with resources for each step."
                  : "Browse openings that match the skills you already have."}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/roadmap" className={buttonVariants()}>
                  <Route />
                  Learning roadmap
                </Link>
                <Link href="/jobs" className={buttonVariants({ variant: "secondary" })}>
                  <BriefcaseBusiness />
                  Browse jobs
                  <ArrowRight />
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
