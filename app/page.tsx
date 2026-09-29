"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ClipboardCheck,
  RefreshCw,
  Sparkles,
} from "lucide-react"

import { supabase } from "@/lib/supabase-browser"
import { cn } from "@/lib/utils"
import { JOURNEY } from "@/lib/journey"
import {
  LEVEL_META,
  countByLevel,
  requiredSkills,
  sortByUrgency,
} from "@/lib/skill-status"
import { parseSkills } from "@/lib/profile-store"
import { jobsApiUrl, readJobLocation } from "@/lib/jobs/location-preference"
import { buttonVariants } from "@/components/ui/button"
import { ReadinessGauge } from "@/components/ui/gauge"
import { CountUp } from "@/components/ui/count-up"
import { Eyebrow, Section } from "@/components/ui/page"
import { EmptyState, Notice, Skeleton } from "@/components/ui/states"
import { StatusBadge } from "@/components/status-badge"

type DashboardJob = {
  id: string
  title: string
  company: string
  location: string
  readiness: number
  type: string
  salary: string
  missingSkills: string[]
  matchedSkills: string[]
  posted: string
}

type ActivityItem = {
  id: string
  type: "course" | "job" | "skill" | "assessment"
  label: string
  detail: string
  time: string
  timestamp: number
}

type DashboardProfile = {
  name: string
  targetRole: string
  experience: string
  // AI estimate from the latest analysis; null when there is none (not "0%").
  readiness: number | null
  learningProgress: number
  skillsCount: number
}

function formatRelativeTime(timestamp: number) {
  const diff = Math.max(0, Date.now() - timestamp)

  const minutes = Math.floor(diff / 60000)

  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)

  if (hours < 24) return `${hours} hr ago`

  const days = Math.floor(hours / 24)

  if (days === 1) return "1 day ago"

  return `${days} days ago`
}

function normalizeJob(job: any, index: number): DashboardJob {
  const readiness = Math.max(
    0,
    Math.min(100, Math.round(Number(job?.match ?? job?.readiness ?? 0)))
  )

  const remote = Boolean(job?.remote)

  return {
    id: String(job?.id ?? `${job?.company ?? "job"}-${job?.title ?? index}`),
    title: String(job?.title ?? "Recommended Role"),
    company: String(job?.company ?? "Company"),
    location: remote
      ? `${String(job?.location ?? "Remote")} · Remote`
      : String(job?.location ?? "Location not specified"),
    readiness,
    type: remote ? "Remote" : String(job?.type ?? "On-site"),
    salary: String(job?.salary ?? job?.source ?? "See job listing"),
    missingSkills: Array.isArray(job?.missingSkills)
      ? job.missingSkills.filter((skill: unknown): skill is string => typeof skill === "string")
      : [],
    matchedSkills: Array.isArray(job?.matchedSkills)
      ? job.matchedSkills.filter((skill: unknown): skill is string => typeof skill === "string")
      : [],
    posted: String(job?.posted ?? job?.source ?? "Updated recently"),
  }
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

const ACTIVITY_ICON: Record<ActivityItem["type"], React.ElementType> = {
  course: BookOpen,
  job: BriefcaseBusiness,
  skill: Sparkles,
  assessment: ClipboardCheck,
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your dashboard">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="space-y-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="flex gap-8 pt-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-20" />
            ))}
          </div>
        </div>
        <Skeleton className="size-44 rounded-full" />
      </div>
      <Skeleton className="mt-12 h-24 w-full rounded-2xl" />
      <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
        <div className="space-y-3 lg:col-span-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [profile, setProfile] = useState<DashboardProfile | null>(null)

  const [aiAnalysis, setAiAnalysis] = useState<any>(null)

  const [recommendedJobs, setRecommendedJobs] = useState<DashboardJob[]>([])
  const [jobsLoaded, setJobsLoaded] = useState(false)

  const [roadmapSkills, setRoadmapSkills] = useState<any[]>([])

  const [activities, setActivities] = useState<ActivityItem[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [manualRefresh, setManualRefresh] = useState(false)
  const [learningNotice, setLearningNotice] = useState("")

  // The AI roadmap depends only on the profile, so /api/learning runs on the first
  // load and manual Refresh only; automatic refreshes reuse the last result.
  // Only manual Refresh asks for a new roadmap (?refresh=1) instead of the stored one.
  const learningDataRef = useRef<any>(null)
  const learningRequestRef = useRef(0)

  const loadDashboard = useCallback(
    async (
      showRefresh = false,
      includeLearning = false,
      refreshLearning = false
    ) => {
      try {
        if (showRefresh) {
          setRefreshing(true)
        } else {
          setLoading(true)
        }

        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          window.location.href = "/login"
          return
        }

        const learningRequestId = includeLearning
          ? ++learningRequestRef.current
          : 0

        const [profileResult, jobsResult, learningResult] = await Promise.all([
          supabase
            .from("profiles")
            .select(
              "name,target_role,experience_level,job_readiness,skills_mastered,skill_gaps,learning_progress,skills"
            )
            .eq("id", user.id)
            .maybeSingle(),

          fetch(jobsApiUrl(readJobLocation()), {
            cache: "no-store",
          }),

          includeLearning
            ? fetch(refreshLearning ? "/api/learning?refresh=1" : "/api/learning", {
                cache: "no-store",
              })
            : Promise.resolve(null),
        ])

        let savedAnalysis: any = null

        try {
          const saved = localStorage.getItem(`skillbridge-ai-analysis-${user.id}`)

          if (saved) {
            savedAnalysis = JSON.parse(saved)
          }
        } catch (error) {
          console.warn("Could not load saved AI analysis:", error)
        }

        // A saved skill-gap analysis describes the role it was made for. Once the career
        // target has changed it no longer applies, so the profile's own figures are shown.
        const analysisRole =
          typeof savedAnalysis?.targetRole === "string"
            ? savedAnalysis.targetRole.trim().toLowerCase()
            : ""
        const currentRole =
          typeof profileResult.data?.target_role === "string"
            ? profileResult.data.target_role.trim().toLowerCase()
            : ""

        if (analysisRole && currentRole && analysisRole !== currentRole) {
          savedAnalysis = null
        }

        setAiAnalysis(savedAnalysis)

        const dbProfile = profileResult.data

        // The AI's estimate when an analysis exists. profiles.job_readiness is only
        // shown if something ever set it above 0; otherwise there is no figure to show.
        const storedReadiness = Number(dbProfile?.job_readiness ?? 0)
        const readiness =
          typeof savedAnalysis?.readiness === "number"
            ? Math.max(0, Math.min(100, Math.round(savedAnalysis.readiness)))
            : storedReadiness > 0
              ? Math.min(100, Math.round(storedReadiness))
              : null

        setProfile({
          name:
            typeof dbProfile?.name === "string" && dbProfile.name.trim()
              ? dbProfile.name.trim()
              : "there",

          targetRole:
            typeof dbProfile?.target_role === "string" && dbProfile.target_role.trim()
              ? dbProfile.target_role.trim()
              : "Software Engineer",

          experience:
            typeof dbProfile?.experience_level === "string" && dbProfile.experience_level.trim()
              ? dbProfile.experience_level.trim()
              : "Beginner",

          readiness,

          learningProgress: Math.max(
            0,
            Math.min(100, Number(dbProfile?.learning_progress ?? 0))
          ),

          skillsCount: parseSkills(dbProfile?.skills).length,
        })

        if (jobsResult.ok) {
          const jobsData = await jobsResult.json()

          const rawJobs = Array.isArray(jobsData)
            ? jobsData
            : Array.isArray(jobsData?.jobs)
              ? jobsData.jobs
              : []

          setRecommendedJobs(
            rawJobs
              .map(normalizeJob)
              .sort((a: DashboardJob, b: DashboardJob) => b.readiness - a.readiness)
              .slice(0, 3)
          )
        } else {
          setRecommendedJobs([])
        }
        setJobsLoaded(true)

        if (learningResult?.status === 429) {
          // Over the per-user AI limit: keep the roadmap already shown.
          const limited = await learningResult.json().catch(() => null)

          if (learningRequestId === learningRequestRef.current) {
            setLearningNotice(
              typeof limited?.message === "string"
                ? limited.message
                : "You've reached the AI request limit. Please try again later."
            )
          }
        } else if (learningResult) {
          const nextLearning = learningResult.ok ? await learningResult.json() : null

          // A learning request that finishes after a newer one started is stale.
          if (learningRequestId === learningRequestRef.current) {
            learningDataRef.current = nextLearning
            setLearningNotice("")

            setRoadmapSkills(Array.isArray(nextLearning?.skills) ? nextLearning.skills : [])
          }
        }

        const learningData: any = learningDataRef.current

        const nextActivities: ActivityItem[] = []

        try {
          const assessmentSaved = localStorage.getItem(`skillbridge-assessment-result-${user.id}`)

          if (assessmentSaved) {
            const assessment = JSON.parse(assessmentSaved)

            if (assessment?.updatedAt) {
              const timestamp = new Date(assessment.updatedAt).getTime()

              if (!Number.isNaN(timestamp)) {
                nextActivities.push({
                  id: "assessment",
                  type: "assessment",
                  label: "Assessment completed",
                  detail: "Your skills and target role were recorded.",
                  time: formatRelativeTime(timestamp),
                  timestamp,
                })
              }
            }
          }
        } catch {
          // Ignore malformed local assessment data.
        }

        if (savedAnalysis?.savedAt || savedAnalysis?.generatedAt) {
          const timestamp = new Date(savedAnalysis.savedAt ?? savedAnalysis.generatedAt).getTime()

          if (!Number.isNaN(timestamp)) {
            nextActivities.push({
              id: "analysis",
              type: "skill",
              label: "Skill gap analysis updated",
              detail: "AI compared your skills with your target role.",
              time: formatRelativeTime(timestamp),
              timestamp,
            })
          }
        }

        if (learningData?.generatedAt) {
          const timestamp = new Date(learningData.generatedAt).getTime()

          if (!Number.isNaN(timestamp)) {
            nextActivities.push({
              id: "roadmap",
              type: "course",
              label: "Learning roadmap generated",
              detail: `${learningData.totalSkills ?? 0} skills · ${learningData.totalHours ?? 0} estimated hours`,
              time: formatRelativeTime(timestamp),
              timestamp,
            })
          }
        }

        setActivities(nextActivities.sort((a, b) => b.timestamp - a.timestamp).slice(0, 4))
      } catch (error) {
        console.error("Dashboard loading error:", error)
      } finally {
        setLoading(false)
        setRefreshing(false)
        setManualRefresh(false)
      }
    },
    []
  )

  useEffect(() => {
    loadDashboard(false, true)

    const interval = window.setInterval(() => {
      loadDashboard(true)
    }, 30000)

    const handleFocus = () => {
      loadDashboard(true)
    }

    window.addEventListener("focus", handleFocus)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", handleFocus)
    }
  }, [loadDashboard])

  useEffect(() => {
    const handleStorage = () => {
      loadDashboard(true)
    }

    window.addEventListener("storage", handleStorage)

    return () => {
      window.removeEventListener("storage", handleStorage)
    }
  }, [loadDashboard])

  if (loading && !profile) {
    return <DashboardSkeleton />
  }

  if (!profile) {
    return (
      <EmptyState
        title="Your dashboard couldn't load"
        description="Check your connection and try again."
        action={
          <button
            type="button"
            onClick={() => loadDashboard(false, true)}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            <RefreshCw />
            Try again
          </button>
        }
      />
    )
  }

  const skills = requiredSkills(aiAnalysis)
  const counts = countByLevel(skills)
  const blockers = sortByUrgency(skills).filter((entry) => entry.level !== "strong")
  const strengths = skills.filter((entry) => entry.level === "strong")

  const learningData: any = learningDataRef.current
  const totalHours = Number(learningData?.totalHours ?? 0)
  const firstStep = roadmapSkills[0]

  const analysisDate = aiAnalysis?.generatedAt ?? aiAnalysis?.savedAt
  const hasAnalysis = Boolean(aiAnalysis)

  // The single most useful next action, from the data that exists.
  const next = profile.skillsCount === 0
    ? {
        title: "Record your skills",
        text: `A short assessment captures what you already know, so SkillBridge can compare it with ${profile.targetRole}.`,
        href: "/assessment",
        cta: "Start assessment",
      }
    : !hasAnalysis
      ? {
          title: "Run your skill gap analysis",
          text: `See which skills ${profile.targetRole} needs that you don't have yet, and why.`,
          href: "/gap-analysis",
          cta: "Analyze my gaps",
        }
      : firstStep?.skill
        ? {
            title: `Start with ${firstStep.skill}`,
            text:
              typeof firstStep.reason === "string" && firstStep.reason
                ? firstStep.reason
                : `The first step of your learning roadmap for ${profile.targetRole}.`,
            href: "/roadmap",
            cta: "Open roadmap",
          }
        : {
            title: "Build your learning roadmap",
            text: `An ordered path through the skills ${profile.targetRole} needs.`,
            href: "/roadmap",
            cta: "Open roadmap",
          }

  // Which stages of the journey already have data. "Ready" means content is waiting;
  // SkillBridge does not track completion of learning or applications yet.
  const stageState: Record<string, { state: "done" | "ready" | "todo"; note: string }> = {
    "/account": { state: "done", note: profile.experience },
    "/assessment": profile.skillsCount > 0
      ? { state: "done", note: `${profile.skillsCount} skills recorded` }
      : { state: "todo", note: "Not started" },
    "/gap-analysis": hasAnalysis
      ? { state: "done", note: analysisDate ? `Updated ${formatRelativeTime(new Date(analysisDate).getTime())}` : "Analyzed" }
      : { state: "todo", note: "Not analyzed" },
    "/roadmap": roadmapSkills.length > 0
      ? { state: "ready", note: `${roadmapSkills.length} steps` }
      : { state: "todo", note: "Not generated" },
    "/jobs": recommendedJobs.length > 0
      ? { state: "ready", note: "Live openings" }
      : { state: "todo", note: jobsLoaded ? "None found" : "Loading" },
    "/readiness": hasAnalysis
      ? { state: "ready", note: "Compare with role" }
      : { state: "todo", note: "Needs analysis" },
  }

  return (
    <div className="space-y-16">
      {/* ---------------------------------------------------------------- Hero */}
      <section className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="min-w-0">
          <Eyebrow>{greeting()}</Eyebrow>
          <h1 className="type-display mt-3 text-foreground">
            {profile.name === "there" ? "Welcome back." : `Welcome back, ${profile.name.split(" ")[0]}.`}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            You&apos;re working toward{" "}
            <Link
              href="/assessment"
              className="font-medium text-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-primary"
            >
              {profile.targetRole}
            </Link>{" "}
            from a {profile.experience.toLowerCase()} level.
          </p>

          {hasAnalysis && typeof aiAnalysis?.summary === "string" && aiAnalysis.summary && (
            <blockquote className="mt-6 max-w-2xl border-l-2 border-ai/50 pl-4">
              <Eyebrow tone="ai">
                <Sparkles className="size-3" />
                From your latest analysis
              </Eyebrow>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{aiAnalysis.summary}</p>
            </blockquote>
          )}

          <dl className="mt-9 flex flex-wrap gap-x-10 gap-y-6">
            {hasAnalysis ? (
              <>
                {(["strong", "developing", "missing"] as const).map((level) => (
                  <div key={level}>
                    <dt className="flex items-center gap-2 text-xs text-subtle-foreground">
                      <span className={cn("size-1.5 rounded-full", LEVEL_META[level].dot)} />
                      {LEVEL_META[level].label} skills
                    </dt>
                    <dd className="type-metric mt-2 text-3xl text-foreground">
                      <CountUp value={counts[level]} />
                    </dd>
                  </div>
                ))}
              </>
            ) : (
              <div>
                <dt className="text-xs text-subtle-foreground">Skills recorded</dt>
                <dd className="type-metric mt-2 text-3xl text-foreground">
                  <CountUp value={profile.skillsCount} />
                </dd>
              </div>
            )}
            {roadmapSkills.length > 0 && (
              <div>
                <dt className="text-xs text-subtle-foreground">Roadmap</dt>
                <dd className="type-metric mt-2 text-3xl text-foreground">
                  <CountUp value={totalHours} />
                  <span className="ml-1 text-base font-medium tracking-normal text-muted-foreground">h</span>
                </dd>
              </div>
            )}
            {profile.learningProgress > 0 && (
              <div>
                <dt className="text-xs text-subtle-foreground">Learning progress</dt>
                <dd className="type-metric mt-2 text-3xl text-foreground">
                  <CountUp value={profile.learningProgress} />%
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="flex flex-col items-center gap-3 lg:pr-4">
          <ReadinessGauge value={profile.readiness} size={196} label="ready" />
          <p className="max-w-[17rem] text-center text-xs leading-relaxed text-subtle-foreground">
            {profile.readiness !== null
              ? `AI estimate of your readiness for ${profile.targetRole}, from your latest skill gap analysis`
              : "Run your skill gap analysis to see an estimate"}
          </p>
        </div>
      </section>

      {/* -------------------------------------------------------- Next step */}
      <section
        className="reveal relative overflow-hidden rounded-2xl p-px"
        style={{ "--i": 1, background: "linear-gradient(120deg, oklch(0.72 0.135 250 / 45%), oklch(0.82 0.11 192 / 25%) 45%, oklch(1 0 0 / 6%))" } as React.CSSProperties}
      >
        <div className="flex flex-col gap-5 rounded-[calc(var(--radius-2xl)-1px)] bg-[oklch(0.175_0.018_255)] px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="min-w-0">
            <Eyebrow tone="primary">Your next step</Eyebrow>
            <p className="mt-2 text-xl font-semibold tracking-[-0.015em] text-foreground">{next.title}</p>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground line-clamp-2">{next.text}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setManualRefresh(true)
                loadDashboard(true, true, true)
              }}
              disabled={refreshing}
              title="Reload your data and regenerate your learning roadmap"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
              aria-label="Refresh dashboard"
            >
              <RefreshCw className={cn(manualRefresh && "animate-spin")} />
            </button>
            <Link href={next.href} className={buttonVariants({ size: "lg" })}>
              {next.cta}
              <ArrowRight />
            </Link>
          </div>
        </div>
      </section>

      {learningNotice && (
        <Notice tone="warning" title="Roadmap not refreshed">
          {learningNotice}
          {roadmapSkills.length > 0 && " Your current roadmap is still shown."}
        </Notice>
      )}

      {/* -------------------------------------------------------- Journey */}
      <Section title="Your journey" description="Where each stage of your career plan stands.">
        <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
          {JOURNEY.map((item) => {
            const status = stageState[item.href]
            const Icon = item.icon
            return (
              <li key={item.href} className="bg-background">
                <Link
                  href={item.href}
                  className="group flex h-full flex-col gap-3 p-4 transition-colors hover:bg-surface-2/60"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full border",
                        status.state === "done" && "border-success/40 bg-success-muted text-success",
                        status.state === "ready" && "border-primary/40 bg-accent text-primary",
                        status.state === "todo" && "border-border-strong text-subtle-foreground"
                      )}
                    >
                      {status.state === "done" ? <Check className="size-4" strokeWidth={2.5} /> : <Icon className="size-4" />}
                    </span>
                    <span className="type-eyebrow text-subtle-foreground">{item.stage}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground group-hover:text-primary">{item.label}</p>
                    <p className="mt-0.5 text-xs text-subtle-foreground">{status.note}</p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ol>
      </Section>

      {/* ------------------------------------------------ Gaps + path + jobs */}
      <div className="grid grid-cols-1 gap-16 lg:grid-cols-12 lg:gap-12">
        <div className="space-y-16 lg:col-span-7">
          <Section
            title="What's in your way"
            description={hasAnalysis ? `Skills ${profile.targetRole} needs, most urgent first.` : undefined}
            action={
              hasAnalysis && (
                <Link href="/gap-analysis" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Full analysis
                  <ArrowRight />
                </Link>
              )
            }
          >
            {!hasAnalysis ? (
              <EmptyState
                title="No analysis yet"
                description={`Your gap analysis shows which ${profile.targetRole} skills you're missing and why each one matters.`}
                action={
                  <Link href="/gap-analysis" className={buttonVariants({ size: "sm" })}>
                    Analyze my gaps
                  </Link>
                }
              />
            ) : blockers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Your latest analysis found no missing or developing skills.
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {blockers.slice(0, 5).map((entry, index) => (
                  <li
                    key={entry.skill}
                    className="reveal flex items-center gap-4 py-3.5"
                    style={{ "--i": index } as React.CSSProperties}
                  >
                    <span className={cn("size-2 shrink-0 rounded-full", LEVEL_META[entry.level].dot)} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{entry.skill}</span>
                    {entry.priority === "high" && <StatusBadge tone="danger">High priority</StatusBadge>}
                    <span className={cn("w-20 text-right text-xs", LEVEL_META[entry.level].text)}>
                      {LEVEL_META[entry.level].label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {strengths.length > 0 && (
              <p className="mt-5 text-sm text-muted-foreground">
                <span className="text-success">Strong in </span>
                {strengths.slice(0, 5).map((entry) => entry.skill).join(", ")}
                {strengths.length > 5 && ` and ${strengths.length - 5} more`}.
              </p>
            )}
          </Section>

          <Section
            title="Your learning path"
            description={roadmapSkills.length > 0 ? `${roadmapSkills.length} skills in recommended order.` : undefined}
            action={
              roadmapSkills.length > 0 && (
                <Link href="/roadmap" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Full roadmap
                  <ArrowRight />
                </Link>
              )
            }
          >
            {roadmapSkills.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="Your roadmap isn't ready yet"
                description="Open the learning roadmap to generate an ordered path for your target role."
                action={
                  <Link href="/roadmap" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    Open roadmap
                  </Link>
                }
              />
            ) : (
              <ol className="relative">
                <span aria-hidden="true" className="grow-y absolute bottom-4 left-[15px] top-4 w-px bg-[linear-gradient(to_bottom,var(--primary),oklch(1_0_0/8%))]" />
                {roadmapSkills.slice(0, 4).map((step: any, index: number) => (
                  <li key={`${step?.skill ?? index}-${index}`} className="reveal relative flex gap-4 pb-5 last:pb-0" style={{ "--i": index } as React.CSSProperties}>
                    <span
                      className={cn(
                        "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                        index === 0
                          ? "border-primary/60 bg-[oklch(0.25_0.05_250)] text-primary"
                          : "border-border-strong bg-background text-subtle-foreground"
                      )}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <p className="text-sm font-medium text-foreground">{step?.skill ?? "Recommended skill"}</p>
                        {typeof step?.estimatedHours === "number" && (
                          <span className="text-xs tabular-nums text-subtle-foreground">~{step.estimatedHours} h</span>
                        )}
                        {index === 0 && <StatusBadge tone="primary">Start here</StatusBadge>}
                      </div>
                      {typeof step?.phase === "string" && step.phase && (
                        <p className="mt-0.5 text-xs text-subtle-foreground">{step.phase}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <div className="space-y-16 lg:col-span-5">
          <Section
            title="Opportunities"
            description="Live openings ranked by keyword match with your profile."
            action={
              <Link href="/jobs" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                All jobs
                <ArrowRight />
              </Link>
            }
          >
            {!jobsLoaded ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : recommendedJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No openings are available right now.</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {recommendedJobs.map((job) => (
                  <li key={job.id}>
                    <Link href="/jobs" className="group flex items-center gap-4 py-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">{job.title}</p>
                        <p className="mt-0.5 truncate text-xs text-subtle-foreground">
                          {job.company} · {job.location}
                        </p>
                      </div>
                      <div className="w-14 shrink-0 text-right">
                        <p className="type-metric text-sm text-foreground">{job.readiness}%</p>
                        <p className="text-[11px] text-subtle-foreground">match</p>
                      </div>
                      <ArrowUpRight className="size-4 shrink-0 text-subtle-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Recent activity">
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Complete your assessment to start your activity timeline.
              </p>
            ) : (
              <ol className="relative space-y-5">
                <span aria-hidden="true" className="absolute bottom-2 left-[15px] top-2 w-px bg-border" />
                {activities.map((activity) => {
                  const Icon = ACTIVITY_ICON[activity.type]
                  return (
                    <li key={activity.id} className="relative flex gap-4">
                      <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-background text-muted-foreground">
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 pt-0.5">
                        <p className="text-sm font-medium text-foreground">{activity.label}</p>
                        <p className="truncate text-xs text-muted-foreground">{activity.detail}</p>
                        <p className="mt-0.5 text-[11px] text-subtle-foreground">{activity.time}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
