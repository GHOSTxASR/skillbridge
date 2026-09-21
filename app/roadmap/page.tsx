"use client"

import { useEffect, useMemo, useState } from "react"
import {
  BookOpen,
  ExternalLink,
  Code2,
  Loader2,
  PlayCircle,
} from "lucide-react"

import { supabase } from "@/lib/supabase-browser"
import { Card, CardContent } from "@/components/card"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { SkillBadge } from "@/components/skill-badge"
import { ProgressBar } from "@/components/progress-bar"

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

function ResourceIcon({ type }: { type: Resource["type"] }) {
  if (type === "github") {
    return <Code2 className="size-4" />
  }

  if (type === "video") {
    return <PlayCircle className="size-4" />
  }

  return <BookOpen className="size-4" />
}

function getSkillName(skill: RoadmapSkill | string) {
  return typeof skill === "string" ? skill : skill.skill
}

export default function RoadmapPage() {
  const [aiPriorities, setAiPriorities] = useState<string[]>([])
  const [data, setData] = useState<LearningResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    try {
      const keys = Object.keys(localStorage)

      const analysisKey = keys.find((key) =>
        key.startsWith("skillbridge-ai-analysis-")
      )

      if (!analysisKey) return

      const saved = localStorage.getItem(analysisKey)

      if (!saved) return

      const analysis = JSON.parse(saved)

      if (Array.isArray(analysis?.prioritySkills)) {
        setAiPriorities(
          analysis.prioritySkills.filter(
            (skill: unknown): skill is string => typeof skill === "string"
          )
        )
      }
    } catch (error) {
      console.warn("Could not load AI roadmap priorities:", error)
    }
  }, [])

  useEffect(() => {
    async function loadLearning() {
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

        const response = await fetch("/api/learning", {
          cache: "no-store",
        })

        const result = await response.json()

        if (!response.ok) {
          throw new Error(
            result.error || "Unable to load learning resources"
          )
        }

        setData(result)
      } catch (err) {
        console.error("Learning page error:", err)
        setError("Unable to load your personalized learning roadmap.")
      } finally {
        setLoading(false)
      }
    }

    loadLearning()
  }, [])

  const resourcesBySkill = useMemo(() => {
    if (!data) return {}

    return data.skills.reduce<Record<string, Resource[]>>(
      (groups, roadmapSkill) => {
        const skillName = getSkillName(roadmapSkill)

        if (!skillName) return groups

        groups[skillName] = data.resources.filter(
          (resource) =>
            String(resource.skill ?? "").toLowerCase() ===
            skillName.toLowerCase()
        )

        return groups
      },
      {}
    )
  }, [data])

  const totalResources = data?.resources.length ?? 0

  const skillProgress =
    data?.skills.length
      ? Math.round(
          (data.skills.filter((skill) => {
            const skillName = getSkillName(skill)

            return data.resources.some(
              (resource) =>
                String(resource.skill ?? "").toLowerCase() ===
                skillName.toLowerCase()
            )
          }).length /
            data.skills.length) *
            100
        )
      : 0

  const prioritySet = new Set(
    aiPriorities.map((skill) => skill.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-primary" />
          Building your personalized learning roadmap...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <PageHeader
          title="Learning Roadmap"
          description="Your personalized learning path."
        />

        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm font-medium text-foreground">{error}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Refresh the page and try again.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Learning Roadmap"
        description={`A personalized learning path for ${
          data?.targetRole ?? "your target role"
        }.`}
        action={
          <StatusBadge tone="primary">
            {data?.skills.length ?? 0} skills
          </StatusBadge>
        }
      />

      {/* AI Recommendation */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-primary">
                GROQ AI LEARNING ADVISOR
              </p>
              <h2 className="mt-1 text-base font-semibold text-foreground">
                What should you learn for this role?
              </h2>
            </div>

            <StatusBadge tone="primary">
              AI Recommended
            </StatusBadge>
          </div>

          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {data?.aiSummary ||
              `AI is analyzing the best skills for your ${data?.targetRole ?? "target role"} career path.`}
          </p>

          {data?.skills && data.skills.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground">
                Recommended learning order
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                {data.skills.slice(0, 10).map((skill, index) => (
                  <span
                    key={`${skill.skill}-${index}`}
                    className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-foreground"
                  >
                    {index + 1}. {skill.skill}
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {/* Overview */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <ProgressBar
            value={skillProgress}
            tone="primary"
            label="Learning coverage"
            showLabel
          />

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md bg-accent p-3">
              <p className="text-xs text-muted-foreground">Target Role</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {data?.targetRole}
              </p>
            </div>

            <div className="rounded-md bg-accent p-3">
              <p className="text-xs text-muted-foreground">Skills</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {data?.skills.length ?? 0}
              </p>
            </div>

            <div className="rounded-md bg-accent p-3">
              <p className="text-xs text-muted-foreground">Resources</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {totalResources}
              </p>
            </div>

            <div className="rounded-md bg-accent p-3">
              <p className="text-xs text-muted-foreground">Sources</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {[
                  data?.sources.github,
                  data?.sources.youtube,
                  data?.sources.documentation,
                ].filter(Boolean).length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Skills */}
      <div className="mb-8">
        <h2 className="mb-3 text-base font-semibold text-foreground">
          Skills for your target role
        </h2>

        <div className="flex flex-wrap gap-2">
            {aiPriorities.length > 0 ? (
              aiPriorities.map((skill, index) => (
                <SkillBadge
                  key={`${skill}-${index}`}
                  name={skill}
                />
              ))
            ) : (
              data?.skills.map((skill) => {
                const skillName = getSkillName(skill)

                return (
                  <SkillBadge
                    key={skillName}
                    name={skillName}
                  />
                )
              })
            )}
          </div>
      </div>

      {/* Learning resources */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          Recommended Learning Resources
        </h2>

        <div className="space-y-6">
          {data?.skills.map((roadmapSkill) => {
            const skillName = getSkillName(roadmapSkill)
            const resources = resourcesBySkill[skillName] ?? []
            const isPriority = prioritySet.has(skillName.toLowerCase())

            return (
              <section key={skillName}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">
                        {skillName}
                      </h3>

                      {isPriority && (
                        <StatusBadge tone="primary">
                          Priority
                        </StatusBadge>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {resources.length} learning resources
                    </p>
                  </div>

                  <StatusBadge tone="neutral">
                    {resources.length} resources
                  </StatusBadge>
                </div>

                {/* AI roadmap details */}
                {typeof roadmapSkill === "object" && (
                  <Card className="mb-4">
                    <CardContent className="p-5">
                      <div className="grid gap-4 sm:grid-cols-2">
                        {roadmapSkill.phase && (
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Phase
                            </p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {roadmapSkill.phase}
                            </p>
                          </div>
                        )}

                        {roadmapSkill.estimatedHours !== undefined && (
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Estimated Time
                            </p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {roadmapSkill.estimatedHours} hours
                            </p>
                          </div>
                        )}

                        {roadmapSkill.reason && (
                          <div className="sm:col-span-2">
                            <p className="text-xs text-muted-foreground">
                              Why learn this?
                            </p>
                            <p className="mt-1 text-sm text-foreground">
                              {roadmapSkill.reason}
                            </p>
                          </div>
                        )}

                        {roadmapSkill.prerequisite && (
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Prerequisite
                            </p>
                            <p className="mt-1 text-sm text-foreground">
                              {roadmapSkill.prerequisite}
                            </p>
                          </div>
                        )}

                        {roadmapSkill.project && (
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Project
                            </p>
                            <p className="mt-1 text-sm text-foreground">
                              {roadmapSkill.project}
                            </p>
                          </div>
                        )}

                        {roadmapSkill.checkpoint && (
                          <div className="sm:col-span-2">
                            <p className="text-xs text-muted-foreground">
                              Checkpoint
                            </p>
                            <p className="mt-1 text-sm text-foreground">
                              {roadmapSkill.checkpoint}
                            </p>
                          </div>
                        )}
                      </div>

                      {roadmapSkill.topics &&
                        roadmapSkill.topics.length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs text-muted-foreground">
                              Topics
                            </p>

                            <div className="mt-2 flex flex-wrap gap-2">
                              {roadmapSkill.topics.map((topic, index) => (
                                <span
                                  key={`${skillName}-topic-${index}`}
                                  className="rounded-md bg-accent px-2 py-1 text-xs text-foreground"
                                >
                                  {topic}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                      {roadmapSkill.practice &&
                        roadmapSkill.practice.length > 0 && (
                          <div className="mt-4">
                            <p className="text-xs text-muted-foreground">
                              Practice
                            </p>

                            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-foreground">
                              {roadmapSkill.practice.map((item, index) => (
                                <li key={`${skillName}-practice-${index}`}>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                    </CardContent>
                  </Card>
                )}

                {resources.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {resources.map((resource) => (
                      <Card
                        key={resource.id}
                        className="flex flex-col p-5 transition-shadow hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                            <ResourceIcon type={resource.type} />
                          </span>

                          <StatusBadge tone="neutral">
                            {resource.type === "github"
                              ? "Open Source"
                              : resource.type === "video"
                                ? "Video"
                                : "Docs"}
                          </StatusBadge>
                        </div>

                        <h4 className="mt-3 line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                          {resource.title}
                        </h4>

                        <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                          {resource.description ||
                            "Free learning resource."}
                        </p>

                        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{resource.source}</span>

                          {resource.free && (
                            <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">
                              Free
                            </span>
                          )}
                        </div>

                        <div className="mt-4 border-t border-border pt-3">
                          <a
                            href={resource.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                          >
                            Open Resource
                            <ExternalLink className="size-3.5" />
                          </a>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-5">
                      <p className="text-xs text-muted-foreground">
                        No resources found for this skill yet.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </section>
            )
          })}
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Resources are fetched dynamically from public learning sources.
        Source freshness may vary by provider.
      </p>
    </div>
  )
}



