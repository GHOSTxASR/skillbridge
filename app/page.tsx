"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase-browser"

import Link from "next/link"
import {
  Target,
  CheckCircle2,
  AlertTriangle,
  GraduationCap,
  ArrowRight,
  BookOpen,
  Briefcase,
  Sparkles,
  Award,
  ClipboardCheck,
  RefreshCw,
} from "lucide-react"

import { Card, CardHeader, CardTitle, CardContent } from "@/components/card"
import { MetricCard } from "@/components/metric-card"
import { JobCard } from "@/components/job-card"
import { DynamicReadiness } from "@/components/dynamic-readiness"
import { SkillBadge } from "@/components/skill-badge"
import { ProgressBar } from "@/components/progress-bar"
import { StatusBadge } from "@/components/status-badge"
import { buttonVariants } from "@/components/ui/button"

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
  jobReadiness: number
  skillsMastered: number
  skillGaps: number
  learningProgress: number
}

function activityIcon(type: ActivityItem["type"]) {
  if (type === "course") return BookOpen
  if (type === "job") return Briefcase
  if (type === "skill") return Award
  return ClipboardCheck
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
    Math.min(
      100,
      Math.round(
        Number(job?.match ?? job?.readiness ?? 0)
      )
    )
  )

  const remote = Boolean(job?.remote)

  return {
    id: String(
      job?.id ??
        `${job?.company ?? "job"}-${job?.title ?? index}`
    ),
    title: String(job?.title ?? "Recommended Role"),
    company: String(job?.company ?? "Company"),
    location: remote
      ? `${String(job?.location ?? "Remote")} · Remote`
      : String(job?.location ?? "Location not specified"),
    readiness,
    type: remote
      ? "Remote"
      : String(job?.type ?? "On-site"),
    salary: String(
      job?.salary ??
        job?.source ??
        "See job listing"
    ),
    missingSkills: Array.isArray(job?.missingSkills)
      ? job.missingSkills.filter(
          (skill: unknown): skill is string =>
            typeof skill === "string"
        )
      : [],
    matchedSkills: Array.isArray(job?.matchedSkills)
      ? job.matchedSkills.filter(
          (skill: unknown): skill is string =>
            typeof skill === "string"
        )
      : [],
    posted: String(
      job?.posted ??
        job?.source ??
        "Updated recently"
    ),
  }
}

export default function DashboardPage() {
  const [profile, setProfile] =
    useState<DashboardProfile | null>(null)

  const [aiAnalysis, setAiAnalysis] =
    useState<any>(null)

  const [recommendedJobs, setRecommendedJobs] =
    useState<DashboardJob[]>([])

  const [roadmapSkills, setRoadmapSkills] =
    useState<any[]>([])

  const [activities, setActivities] =
    useState<ActivityItem[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadDashboard = useCallback(
    async (showRefresh = false) => {
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

        const [
          profileResult,
          jobsResult,
          learningResult,
        ] = await Promise.all([
          supabase
            .from("profiles")
            .select(
              "name,target_role,experience_level,job_readiness,skills_mastered,skill_gaps,learning_progress"
            )
            .eq("id", user.id)
            .maybeSingle(),

          fetch("/api/jobs", {
            cache: "no-store",
          }),

          fetch("/api/learning", {
            cache: "no-store",
          }),
        ])

        let savedAnalysis: any = null

        try {
          const analysisKey =
            `skillbridge-ai-analysis-${user.id}`

          const saved =
            localStorage.getItem(analysisKey)

          if (saved) {
            savedAnalysis = JSON.parse(saved)
          }
        } catch (error) {
          console.warn(
            "Could not load saved AI analysis:",
            error
          )
        }

        setAiAnalysis(savedAnalysis)

        const dbProfile = profileResult.data

        const readiness = Math.max(
          0,
          Math.min(
            100,
            Math.round(
              savedAnalysis?.readiness ??
                dbProfile?.job_readiness ??
                0
            )
          )
        )

        const masteredCount =
          Array.isArray(savedAnalysis?.skillGaps)
            ? savedAnalysis.skillGaps.filter(
                (skill: any) =>
                  skill?.status === "mastered"
              ).length
            : Number(
                dbProfile?.skills_mastered ?? 0
              )

        const gapCount =
          Array.isArray(
            savedAnalysis?.missingSkills
          )
            ? savedAnalysis.missingSkills.length
            : Array.isArray(
                  savedAnalysis?.skillGaps
                )
              ? savedAnalysis.skillGaps.filter(
                  (skill: any) =>
                    skill?.status === "gap" ||
                    skill?.status === "critical" ||
                    skill?.status === "in-progress"
                ).length
              : Number(
                  dbProfile?.skill_gaps ?? 0
                )

        setProfile({
          name:
            typeof dbProfile?.name === "string" &&
            dbProfile.name.trim()
              ? dbProfile.name.trim()
              : "User",

          targetRole:
            typeof dbProfile?.target_role ===
              "string" &&
            dbProfile.target_role.trim()
              ? dbProfile.target_role.trim()
              : "Software Engineer",

          experience:
            typeof dbProfile?.experience_level ===
              "string" &&
            dbProfile.experience_level.trim()
              ? dbProfile.experience_level.trim()
              : "Beginner",

          jobReadiness: readiness,

          skillsMastered:
            Math.max(0, masteredCount),

          skillGaps:
            Math.max(0, gapCount),

          learningProgress: Math.max(
            0,
            Math.min(
              100,
              Number(
                dbProfile?.learning_progress ?? 0
              )
            )
          ),
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
              .sort(
                (a: DashboardJob, b: DashboardJob) =>
                  b.readiness - a.readiness
              )
              .slice(0, 2)
          )
        } else {
          setRecommendedJobs([])
        }

        let learningData: any = null

        if (learningResult.ok) {
          learningData = await learningResult.json()

          setRoadmapSkills(
            Array.isArray(learningData?.skills)
              ? learningData.skills
              : []
          )
        } else {
          setRoadmapSkills([])
        }

        const nextActivities: ActivityItem[] = []

        try {
          const assessmentKey =
            `skillbridge-assessment-result-${user.id}`

          const assessmentSaved =
            localStorage.getItem(assessmentKey)

          if (assessmentSaved) {
            const assessment =
              JSON.parse(assessmentSaved)

            if (assessment?.updatedAt) {
              const timestamp =
                new Date(
                  assessment.updatedAt
                ).getTime()

              if (!Number.isNaN(timestamp)) {
                nextActivities.push({
                  id: "assessment",
                  type: "assessment",
                  label: "Assessment completed",
                  detail:
                    "Your career assessment is being used for AI recommendations.",
                  time: formatRelativeTime(
                    timestamp
                  ),
                  timestamp,
                })
              }
            }
          }
        } catch {
          // Ignore malformed local assessment data.
        }

        if (
          savedAnalysis?.savedAt ||
          savedAnalysis?.generatedAt
        ) {
          const timestamp = new Date(
            savedAnalysis.savedAt ??
              savedAnalysis.generatedAt
          ).getTime()

          if (!Number.isNaN(timestamp)) {
            nextActivities.push({
              id: "analysis",
              type: "skill",
              label: "AI skill gap analysis updated",
              detail:
                "Groq AI refreshed your skills and career priorities.",
              time: formatRelativeTime(timestamp),
              timestamp,
            })
          }
        }

        if (learningData?.generatedAt) {
          const timestamp = new Date(
            learningData.generatedAt
          ).getTime()

          if (!Number.isNaN(timestamp)) {
            nextActivities.push({
              id: "roadmap",
              type: "course",
              label:
                "Personalized learning roadmap generated",
              detail:
                `${learningData.totalSkills ?? 0} recommended skills and ${learningData.totalHours ?? 0} estimated learning hours.`,
              time: formatRelativeTime(timestamp),
              timestamp,
            })
          }
        }

        if (recommendedJobs.length > 0) {
          // Jobs are refreshed dynamically; no fake activity is added.
        }

        setActivities(
          nextActivities
            .sort(
              (a, b) =>
                b.timestamp - a.timestamp
            )
            .slice(0, 4)
        )
      } catch (error) {
        console.error(
          "Dashboard loading error:",
          error
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    []
  )

  useEffect(() => {
    loadDashboard()

    const interval = window.setInterval(() => {
      loadDashboard(true)
    }, 30000)

    const handleFocus = () => {
      loadDashboard(true)
    }

    window.addEventListener(
      "focus",
      handleFocus
    )

    return () => {
      window.clearInterval(interval)
      window.removeEventListener(
        "focus",
        handleFocus
      )
    }
  }, [loadDashboard])

  useEffect(() => {
    const handleStorage = () => {
      loadDashboard(true)
    }

    window.addEventListener(
      "storage",
      handleStorage
    )

    return () => {
      window.removeEventListener(
        "storage",
        handleStorage
      )
    }
  }, [loadDashboard])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="size-5 animate-spin text-primary" />
          Loading your live SkillBridge dashboard...
        </div>
      </div>
    )
  }

  const user = {
    name: profile?.name ?? "User",
    initials:
      profile?.name
        ?.split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() ?? "U",
    targetRole:
      profile?.targetRole ??
      "Software Engineer",
    experience:
      profile?.experience ?? "Beginner",
    jobReadiness:
      profile?.jobReadiness ?? 0,
    skillsMastered:
      profile?.skillsMastered ?? 0,
    skillGaps:
      profile?.skillGaps ?? 0,
    learningProgress:
      profile?.learningProgress ?? 0,
  }

  const masteredSkills = Array.isArray(
    aiAnalysis?.skillGaps
  )
    ? aiAnalysis.skillGaps
        .filter(
          (skill: any) =>
            skill?.status === "mastered"
        )
        .slice(0, 6)
    : []

  const gapSkillNames = Array.isArray(
    aiAnalysis?.missingSkills
  )
    ? aiAnalysis.missingSkills
    : Array.isArray(aiAnalysis?.weakSkills)
      ? aiAnalysis.weakSkills
      : Array.isArray(aiAnalysis?.skillGaps)
        ? aiAnalysis.skillGaps
            .filter(
              (skill: any) =>
                skill?.status === "gap" ||
                skill?.status === "critical" ||
                skill?.status === "in-progress"
            )
            .map(
              (skill: any) =>
                skill?.skill ??
                skill?.name
            )
            .filter(
              (skill: unknown): skill is string =>
                typeof skill === "string"
            )
        : []

  return (
    <div>
      {/* Hero greeting + readiness */}
      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <StatusBadge
              tone="primary"
              icon={
                <Sparkles className="size-3.5" />
              }
            >
              {aiAnalysis
                ? "AI analysis up to date"
                : "Complete assessment for AI analysis"}
            </StatusBadge>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground text-balance">
              Welcome back,{" "}
              {user.name.split(" ")[0]}
            </h1>

            <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
              You&apos;re working toward{" "}
              <span className="font-medium text-foreground">
                {user.targetRole}
              </span>
              .
              {aiAnalysis?.summary
                ? ` ${aiAnalysis.summary}`
                : " Complete your assessment to get personalized AI recommendations."}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground">
                <Target className="size-4 text-primary" />
                {user.targetRole}
              </span>

              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground">
                {user.experience}
              </span>

              <Link
                href="/assessment"
                className={buttonVariants({
                  size: "sm",
                  variant: "outline",
                })}
              >
                Update assessment
                <ArrowRight className="size-3.5" />
              </Link>

              <button
                type="button"
                onClick={() =>
                  loadDashboard(true)
                }
                disabled={refreshing}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw
                  className={`size-4 ${
                    refreshing
                      ? "animate-spin"
                      : ""
                  }`}
                />
                Refresh
              </button>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-center rounded-lg bg-secondary/60 px-8 py-4">
            <DynamicReadiness
              fallback={user.jobReadiness}
            />
          </div>
        </div>
      </Card>

      {/* Metrics */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Job Readiness"
          value={user.jobReadiness}
          unit="%"
          icon={Target}
          tone="primary"
          hint={
            aiAnalysis
              ? "from AI career analysis"
              : "from your profile"
          }
        />

        <MetricCard
          label="Skills Mastered"
          value={user.skillsMastered}
          icon={CheckCircle2}
          tone="success"
          hint="from AI skill analysis"
        />

        <MetricCard
          label="Skill Gaps"
          value={user.skillGaps}
          icon={AlertTriangle}
          tone="warning"
          hint="to close for target role"
        />

        <MetricCard
          label="Learning Progress"
          value={user.learningProgress}
          unit="%"
          icon={GraduationCap}
          tone="neutral"
          hint="saved learning progress"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Recommended jobs */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">
                Recommended Jobs
              </h2>

              <Link
                href="/jobs"
                className={buttonVariants({
                  variant: "ghost",
                  size: "sm",
                })}
              >
                View all
                <ArrowRight className="size-3.5" />
              </Link>
            </div>

            {recommendedJobs.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {recommendedJobs.map(
                  (job) => (
                    <JobCard
                      key={job.id}
                      job={job as any}
                    />
                  )
                )}
              </div>
            ) : (
              <Card>
                <CardContent className="p-6 text-center">
                  <p className="text-sm font-medium text-foreground">
                    No recommended jobs available yet.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Complete your assessment and keep your profile updated to improve job recommendations.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Skills snapshot */}
          <Card>
            <CardHeader>
              <CardTitle>
                Skills Snapshot
              </CardTitle>

              <Link
                href="/gap-analysis"
                className={buttonVariants({
                  variant: "ghost",
                  size: "sm",
                })}
              >
                Full analysis
                <ArrowRight className="size-3.5" />
              </Link>
            </CardHeader>

            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-success">
                  Mastered
                </p>

                <div className="flex flex-wrap gap-2">
                  {masteredSkills.length > 0 ? (
                    masteredSkills.map(
                      (skill: any, index: number) => (
                        <SkillBadge
                          key={`mastered-${index}`}
                          name={
                            skill?.skill ??
                            skill?.name ??
                            "Skill"
                          }
                          status="mastered"
                        />
                      )
                    )
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No mastered skills recorded yet.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-warning">
                  Skill Gaps
                </p>

                <div className="flex flex-wrap gap-2">
                  {gapSkillNames.length > 0 ? (
                    gapSkillNames
                      .slice(0, 8)
                      .map(
                        (
                          skill: string,
                          index: number
                        ) => (
                          <SkillBadge
                            key={`gap-${index}`}
                            name={skill}
                            status="gap"
                          />
                        )
                      )
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No critical skill gaps recorded yet.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Learning progress */}
          <Card>
            <CardHeader>
              <CardTitle>
                Learning Progress
              </CardTitle>

              <StatusBadge tone="primary">
                {user.learningProgress}%
              </StatusBadge>
            </CardHeader>

            <CardContent className="space-y-4">
              <ProgressBar
                value={user.learningProgress}
                tone="primary"
              />

              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Recommended next skills
                </p>

                {roadmapSkills.length > 0 ? (
                  roadmapSkills
                    .slice(0, 3)
                    .map(
                      (
                        roadmapSkill: any,
                        index: number
                      ) => (
                        <div
                          key={`${roadmapSkill?.skill ?? index}`}
                          className="rounded-md border border-border bg-card p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-foreground">
                              {index + 1}.{" "}
                              {roadmapSkill?.skill ??
                                "Recommended skill"}
                            </span>

                            <StatusBadge tone="neutral">
                              Recommended
                            </StatusBadge>
                          </div>
                        </div>
                      )
                    )
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Generate your learning roadmap to see recommended skills here.
                  </p>
                )}
              </div>

              <Link
                href="/roadmap"
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "w-full",
                })}
              >
                Open learning roadmap
                <ArrowRight className="size-3.5" />
              </Link>
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card>
            <CardHeader>
              <CardTitle>
                Recent Activity
              </CardTitle>
            </CardHeader>

            <CardContent className="p-0">
              {activities.length > 0 ? (
                <ul className="divide-y divide-border">
                  {activities.map(
                    (activity) => {
                      const Icon =
                        activityIcon(
                          activity.type
                        )

                      return (
                        <li
                          key={activity.id}
                          className="flex gap-3 px-5 py-3.5"
                        >
                          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                            <Icon className="size-4" />
                          </span>

                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {activity.label}
                            </p>

                            <p className="truncate text-xs text-muted-foreground">
                              {activity.detail}
                            </p>

                            <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                              {activity.time}
                            </p>
                          </div>
                        </li>
                      )
                    }
                  )}
                </ul>
              ) : (
                <div className="p-5">
                  <p className="text-xs text-muted-foreground">
                    Complete your assessment to start building your activity timeline.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
