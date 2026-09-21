"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  Target,
  BrainCircuit,
  BookOpen,
  Code2,
} from "lucide-react"

import { supabase } from "@/lib/supabase-browser"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/card"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { StatusBadge } from "@/components/status-badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SkillGap = {
  skill: string
  category?: string
  currentLevel?: number
  requiredLevel?: number
  status?: "mastered" | "in-progress" | "gap"
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
}

function SkillRow({ skill }: { skill: SkillGap }) {
  const current = Math.max(0, Math.min(100, skill.currentLevel ?? 0))
  const required = Math.max(0, Math.min(100, skill.requiredLevel ?? 80))
  const deficit = Math.max(0, required - current)

  const status =
    skill.status ??
    (current >= required
      ? "mastered"
      : current >= required - 20
        ? "in-progress"
        : "gap")

  const barColor =
    status === "mastered"
      ? "bg-success"
      : status === "in-progress"
        ? "bg-primary"
        : "bg-warning"

  return (
    <div className="py-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {skill.skill}
          </span>

          {skill.category && (
            <span className="text-xs text-muted-foreground">
              {skill.category}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className="text-muted-foreground">
            You{" "}
            <span className="font-semibold text-foreground">
              {current}%
            </span>
          </span>

          <span className="text-muted-foreground">
            Target{" "}
            <span className="font-semibold text-foreground">
              {required}%
            </span>
          </span>
        </div>
      </div>

      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-border"
          style={{ width: `${required}%` }}
        />

        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            barColor
          )}
          style={{ width: `${current}%` }}
        />
      </div>

      {deficit > 0 && (
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-warning">
            {deficit}% below target
          </p>

          {skill.priority && (
            <StatusBadge
              tone={
                skill.priority === "high"
                  ? "warning"
                  : skill.priority === "medium"
                    ? "primary"
                    : "neutral"
              }
            >
              {skill.priority} priority
            </StatusBadge>
          )}
        </div>
      )}

      {skill.reason && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {skill.reason}
        </p>
      )}
    </div>
  )
}

export default function GapAnalysisPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [analysis, setAnalysis] = useState<Analysis | null>(null)

  useEffect(() => {
    async function loadAnalysis() {
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

        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single()

        const savedAssessment = localStorage.getItem(
          `skillbridge-assessment-result-${user.id}`
        )

        let assessment: any = {}

        if (savedAssessment) {
          try {
            assessment = JSON.parse(savedAssessment)
          } catch {
            assessment = {}
          }
        }

        const mergedProfile = {
          ...(profile ?? {}),
          target_role:
            assessment.role ||
            profile?.target_role ||
            "",
          skills:
            Array.isArray(assessment.skills) && assessment.skills.length > 0
              ? assessment.skills
              : Array.isArray(profile?.skills)
                ? profile.skills
                : [],
          experience_level:
            assessment.experience ||
            profile?.experience_level ||
            "",
        }

        const response = await fetch("/api/ai/career-analysis", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            profile: mergedProfile,
          }),
        })

        const result = await response.json()

        if (!response.ok) {
          throw new Error(
            result?.error || "Unable to generate AI skill gap analysis"
          )
        }

        const aiResult: Analysis = result

        setAnalysis(aiResult)

        localStorage.setItem(
          `skillbridge-ai-analysis-${user.id}`,
          JSON.stringify({
            ...aiResult,
            savedAt: new Date().toISOString(),
          })
        )
      } catch (err) {
        console.error("AI skill gap analysis error:", err)
        setError(
          err instanceof Error
            ? err.message
            : "Unable to generate your AI skill gap analysis."
        )
      } finally {
        setLoading(false)
      }
    }

    loadAnalysis()
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-[500px] flex-col items-center justify-center gap-3">
        <BrainCircuit className="size-8 animate-pulse text-primary" />
        <p className="text-sm font-medium text-foreground">
          Groq AI is analyzing your career profile...
        </p>
        <p className="text-xs text-muted-foreground">
          Comparing your current skills with your target role.
        </p>
      </div>
    )
  }

  if (error || !analysis) {
    return (
      <div>
        <PageHeader
          title="Skill Gap Analysis"
          description="AI-powered analysis of your current skills and career target."
        />

        <Card className="border-warning/30">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 text-warning" />

              <div>
                <p className="font-semibold text-foreground">
                  Unable to generate AI analysis
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  {error || "Please complete your assessment and try again."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const targetRole = analysis.targetRole || "your target role"
  const readiness = Math.max(
    0,
    Math.min(100, Math.round(analysis.readiness ?? 0))
  )

  const skillGaps = Array.isArray(analysis.skillGaps)
    ? analysis.skillGaps
    : []

  const strengths = Array.isArray(analysis.strengths)
    ? analysis.strengths
    : []

  const missingSkills = Array.isArray(analysis.missingSkills)
    ? analysis.missingSkills
    : Array.isArray(analysis.gaps)
      ? analysis.gaps
      : []

  const weakSkills = Array.isArray(analysis.weakSkills)
    ? analysis.weakSkills
    : []

  const prioritySkills = Array.isArray(analysis.prioritySkills)
    ? analysis.prioritySkills
    : []

  const roadmap = Array.isArray(analysis.roadmap)
    ? analysis.roadmap
    : []

  const mastered = skillGaps.filter(
    (skill) => skill.status === "mastered"
  )

  const inProgress = skillGaps.filter(
    (skill) => skill.status === "in-progress"
  )

  const criticalGaps = skillGaps.filter(
    (skill) => skill.status === "gap"
  )

  return (
    <div>
      <PageHeader
        title="Skill Gap Analysis"
        description={`Groq AI comparison of your skills against the ${targetRole} career requirements.`}
        action={
          <Link
            href="/roadmap"
            className={buttonVariants({ size: "sm" })}
          >
            View full learning roadmap
            <ArrowRight className="size-3.5" />
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <MetricCard
          label="AI Readiness"
          value={`${readiness}%`}
          icon={Target}
          tone="primary"
          hint="estimated career readiness"
        />

        <MetricCard
          label="Mastered Skills"
          value={mastered.length}
          icon={CheckCircle2}
          tone="success"
          hint="strong enough for target"
        />

        <MetricCard
          label="Weak Skills"
          value={weakSkills.length}
          icon={Clock}
          tone="primary"
          hint="need improvement"
        />

        <MetricCard
          label="Critical Gaps"
          value={criticalGaps.length || missingSkills.length}
          icon={AlertTriangle}
          tone="warning"
          hint="need focused learning"
        />
      </div>

      <Card className="mb-6 border-primary/20 bg-accent/40">
        <CardContent className="flex items-start gap-3 p-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BrainCircuit className="size-5" />
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                AI Career Analysis
              </p>

              <StatusBadge tone="success">
                {analysis.aiAvailable === false
                  ? "Fallback mode"
                  : "Groq AI"}
              </StatusBadge>
            </div>

            <p className="mt-1 text-sm leading-6 text-muted-foreground text-pretty">
              {analysis.summary ||
                `Your current profile was analyzed against the requirements for ${targetRole}.`}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Current Skills vs Required Skills</CardTitle>

                <StatusBadge tone="primary">
                  {skillGaps.length} analyzed
                </StatusBadge>
              </div>
            </CardHeader>

            <CardContent className="divide-y divide-border py-0">
              {skillGaps.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No detailed skill comparison was returned.
                </div>
              ) : (
                skillGaps.map((skill, index) => (
                  <SkillRow
                    key={`${skill.skill}-${index}`}
                    skill={skill}
                  />
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What You Need To Learn</CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              {missingSkills.length === 0 && weakSkills.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No major learning gaps detected by the AI analysis.
                </p>
              ) : (
                <>
                  {missingSkills.map((skill, index) => (
                    <div
                      key={`missing-${skill}-${index}`}
                      className="flex items-start gap-3 rounded-lg border border-warning/20 bg-warning-muted/40 p-3"
                    >
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />

                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {skill}
                        </p>

                        <p className="mt-1 text-xs text-muted-foreground">
                          AI identified this as a missing skill for your target
                          role.
                        </p>
                      </div>
                    </div>
                  ))}

                  {weakSkills.map((skill, index) => (
                    <div
                      key={`weak-${skill}-${index}`}
                      className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3"
                    >
                      <Clock className="mt-0.5 size-4 shrink-0 text-primary" />

                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {skill}
                        </p>

                        <p className="mt-1 text-xs text-muted-foreground">
                          You have some foundation here, but AI recommends
                          strengthening it.
                        </p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Priority Skills</CardTitle>

                <StatusBadge tone="warning">
                  {prioritySkills.length}
                </StatusBadge>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {prioritySkills.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No priority skills returned.
                </p>
              ) : (
                prioritySkills.map((skill, index) => (
                  <div
                    key={`${skill}-${index}`}
                    className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-3"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {index + 1}
                    </span>

                    <span className="text-sm font-medium text-foreground">
                      {skill}
                    </span>
                  </div>
                ))
              )}

              <Link
                href="/roadmap"
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "mt-2 w-full",
                })}
              >
                Build full roadmap
                <ArrowRight className="size-3.5" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Strengths</CardTitle>
            </CardHeader>

            <CardContent className="space-y-2">
              {strengths.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No major strengths identified yet.
                </p>
              ) : (
                strengths.map((skill, index) => (
                  <div
                    key={`${skill}-${index}`}
                    className="flex items-center gap-2 text-sm"
                  >
                    <CheckCircle2 className="size-4 shrink-0 text-success" />
                    <span className="text-foreground">{skill}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Job Fit</CardTitle>
            </CardHeader>

            <CardContent>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Estimated fit
                </span>

                <span className="text-lg font-bold text-foreground">
                  {Math.round(analysis.jobFit?.score ?? readiness)}%
                </span>
              </div>

              <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(
                        100,
                        Math.round(
                          analysis.jobFit?.score ?? readiness
                        )
                      )
                    )}%`,
                  }}
                />
              </div>

              {analysis.jobFit?.explanation && (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {analysis.jobFit.explanation}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>AI-Generated Learning Sequence</CardTitle>

            <StatusBadge tone="primary">
              {roadmap.length} steps
            </StatusBadge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {roadmap.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Open the learning roadmap to generate your detailed learning
              plan.
            </p>
          ) : (
            roadmap.slice(0, 8).map((item, index) => (
              <div
                key={`${item.skill}-${index}`}
                className="rounded-lg border border-border p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {item.order || index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">
                        {item.skill}
                      </h3>

                      {item.phase && (
                        <StatusBadge tone="neutral">
                          {item.phase}
                        </StatusBadge>
                      )}

                      {item.estimatedHours && (
                        <span className="text-xs text-muted-foreground">
                          ~{item.estimatedHours}h
                        </span>
                      )}
                    </div>

                    {item.reason && (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {item.reason}
                      </p>
                    )}

                    {item.prerequisite && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Prerequisite:
                        </span>{" "}
                        {item.prerequisite}
                      </p>
                    )}

                    {Array.isArray(item.topics) &&
                      item.topics.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {item.topics.slice(0, 5).map((topic) => (
                            <span
                              key={topic}
                              className="rounded-md bg-secondary px-2 py-1 text-[11px] text-muted-foreground"
                            >
                              {topic}
                            </span>
                          ))}
                        </div>
                      )}

                    {item.project && (
                      <div className="mt-3 flex items-start gap-2 rounded-md bg-accent/40 p-2.5">
                        <Code2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            Project:
                          </span>{" "}
                          {item.project}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}

          <Link
            href="/roadmap"
            className={cn(
              buttonVariants({ size: "sm" }),
              "w-full sm:w-auto"
            )}
          >
            Open full learning roadmap
            <BookOpen className="size-3.5" />
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
