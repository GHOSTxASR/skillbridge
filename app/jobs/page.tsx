"use client"

import { useEffect, useMemo, useState } from "react"
import { Search, SlidersHorizontal, RefreshCw } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { JobCard } from "@/components/job-card"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"

type Filter = "all" | "ready" | "stretch"

type ApiJob = {
  id: string
  title: string
  company: string
  location: string
  remote: boolean
  description: string
  url: string
  source: string
  tags: string[]
  match: number
  locationScore: number
}

type DisplayJob = {
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
  url: string
  locationScore: number
}

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All roles" },
  { id: "ready", label: "Ready (75%+)" },
  { id: "stretch", label: "Stretch roles" },
]

function mapJob(job: ApiJob): DisplayJob {
  const matchedSkills = job.tags.slice(0, 4)

  return {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.remote ? `${job.location} Â· Remote` : job.location,
    readiness: job.match,
    type: job.remote ? "Remote" : "On-site",
    salary: job.source,
    missingSkills: [],
    matchedSkills,
    posted: job.source,
    url: job.url,
    locationScore: job.locationScore,
  }
}

export default function JobsPage() {
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const [jobs, setJobs] = useState<DisplayJob[]>([])
  const [targetRole, setTargetRole] = useState("your target role")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  async function loadJobs() {
    try {
      setLoading(true)
      setError("")

      const response = await fetch("/api/jobs", {
        cache: "no-store",
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Unable to load jobs")
      }

      setTargetRole(data.targetRole || "your target role")
      setJobs((data.jobs || []).map(mapJob))
    } catch (err) {
      console.error("Jobs page error:", err)
      setError("Unable to load live job recommendations.")
      setJobs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadJobs()
  }, [])

  const visibleJobs = useMemo(() => {
    return jobs
      .filter((job) => {
        if (filter === "ready") return job.readiness >= 75
        if (filter === "stretch") return job.readiness < 75
        return true
      })
      .filter((job) => {
        const q = query.trim().toLowerCase()

        if (!q) return true

        return (
          job.title.toLowerCase().includes(q) ||
          job.company.toLowerCase().includes(q) ||
          job.matchedSkills.some((skill) =>
            skill.toLowerCase().includes(q)
          )
        )
      })
      .sort((a, b) => {
        if (b.locationScore !== a.locationScore) {
          return b.locationScore - a.locationScore
        }
        return b.readiness - a.readiness
      })
  }, [jobs, filter, query])

  return (
    <div>
      <PageHeader
        title="Job Recommendations"
        description={`Live job opportunities ranked for your ${targetRole}.`}
        action={
          <StatusBadge tone="primary">
            {jobs.length} matches
          </StatusBadge>
        }
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, company, skill..."
            className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <SlidersHorizontal className="mr-1 size-4 text-muted-foreground" />

          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}

          <button
            type="button"
            onClick={loadJobs}
            disabled={loading}
            className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                loading && "animate-spin"
              )}
            />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <RefreshCw className="mx-auto size-5 animate-spin text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Loading live jobs...
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Finding opportunities matching your profile.
          </p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            {error}
          </p>
          <button
            type="button"
            onClick={loadJobs}
            className="mt-3 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
          >
            Try again
          </button>
        </div>
      ) : visibleJobs.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleJobs.map((job) => (
            <div key={job.id}>
              <JobCard job={job} />

              <div className="px-5 pt-1">
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Apply / View original listing ?
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            No roles found
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a different search or filter.
          </p>
        </div>
      )}

      {!loading && !error && jobs.length > 0 && (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Job data is fetched dynamically from public job providers.
          Availability and freshness depend on the source.
        </p>
      )}
    </div>
  )
}


