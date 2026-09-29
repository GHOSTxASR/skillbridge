"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import {
  ArrowUpRight,
  Building2,
  Check,
  MapPin,
  RefreshCw,
  Search,
  SearchX,
  Wifi,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { Eyebrow, PageHeader } from "@/components/ui/page"
import { EmptyState, ErrorState, LoadingState, Notice, Skeleton } from "@/components/ui/states"
import { StatusBadge } from "@/components/status-badge"
import { JOB_LOCATION_SUGGESTIONS, sanitizeJobLocation } from "@/lib/jobs/location"
import { jobsApiUrl, readJobLocation, saveJobLocation } from "@/lib/jobs/location-preference"

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
  // How the listing's location fits the search: "city", "country" or "remote".
  locationMatch?: string
}

const filters: { id: Filter; label: string; short: string }[] = [
  { id: "all", label: "All", short: "All" },
  { id: "ready", label: "Strong match · 75%+", short: "Strong 75%+" },
  { id: "stretch", label: "Stretch · under 75%", short: "Stretch <75%" },
]

// Same text normalization /api/jobs uses to score a job, so the explanation below
// matches the number: the share of your skills found in the listing (70%) plus 30%
// when your target role appears in the job title.
function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\w+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function explainMatch(job: ApiJob, skills: string[], targetRole: string) {
  const text = normalize(`${job.title} ${job.description} ${job.tags.join(" ")}`)
  const found: string[] = []
  const absent: string[] = []

  for (const skill of skills) {
    const value = normalize(skill)
    if (value && text.includes(value)) found.push(skill)
    else absent.push(skill)
  }

  const role = normalize(targetRole)
  const title = normalize(job.title)
  const roleInTitle = Boolean(role && (title.includes(role) || role.includes(title)))

  return { found, absent, roleInTitle }
}

// Listing descriptions arrive as HTML from third-party boards: show them as plain
// text only (DOMParser builds an inert document; nothing runs or loads).
function plainText(html: string) {
  if (typeof window === "undefined" || !html) return ""
  const doc = new DOMParser().parseFromString(html, "text/html")
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim()
}

function locationLabel(job: ApiJob) {
  return job.remote && !/remote/i.test(job.location) ? `${job.location} · Remote` : job.location
}

function matchTone(match: number) {
  if (match >= 75) return { bar: "bg-success", text: "text-success" }
  if (match >= 40) return { bar: "bg-primary", text: "text-primary" }
  return { bar: "bg-subtle-foreground", text: "text-muted-foreground" }
}

function MatchMeter({ value, className }: { value: number; className?: string }) {
  const tone = matchTone(value)
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[oklch(1_0_0/8%)]">
        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${value}%` }} />
      </div>
      <span className="type-metric w-9 text-right text-sm text-foreground">{value}%</span>
    </div>
  )
}

function JobDetail({
  job,
  skills,
  targetRole,
}: {
  job: ApiJob
  skills: string[]
  targetRole: string
}) {
  const [expanded, setExpanded] = useState(false)
  const why = useMemo(() => explainMatch(job, skills, targetRole), [job, skills, targetRole])
  const description = useMemo(() => plainText(job.description), [job.description])
  const tone = matchTone(job.match)

  useEffect(() => setExpanded(false), [job.id])

  return (
    <article className="flex flex-col gap-8" aria-label={`${job.title} at ${job.company}`}>
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={job.remote ? "primary" : "neutral"} icon={job.remote ? <Wifi /> : undefined}>
            {job.remote ? "Remote" : "On-site"}
          </StatusBadge>
          <StatusBadge>{job.source}</StatusBadge>
        </div>
        <h2 className="mt-4 text-2xl font-semibold leading-tight tracking-[-0.02em] text-foreground text-balance">
          {job.title}
        </h2>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="size-4 text-subtle-foreground" />
            {job.company}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4 text-subtle-foreground" />
            {locationLabel(job)}
          </span>
        </p>
      </header>

      <section aria-labelledby={`match-${job.id}`}>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p id={`match-${job.id}`} className="type-eyebrow text-subtle-foreground">Your match</p>
            <p className={cn("type-metric mt-2 text-5xl", tone.text)}>
              {job.match}
              <span className="text-2xl">%</span>
            </p>
          </div>
          <p className="max-w-[15rem] text-right text-xs leading-relaxed text-subtle-foreground">
            Keyword match: how many of your skills appear in the listing, plus your target
            role in the title.
          </p>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[oklch(1_0_0/8%)]">
          <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${job.match}%` }} />
        </div>

        <dl className="mt-6 space-y-4 text-sm">
          <div>
            <dt className="text-muted-foreground">
              Your skills found in this listing{" "}
              <span className="tabular-nums text-subtle-foreground">
                ({why.found.length} of {skills.length})
              </span>
            </dt>
            <dd className="mt-2 flex flex-wrap gap-1.5">
              {why.found.length === 0 ? (
                <span className="text-subtle-foreground">None of your skills are mentioned.</span>
              ) : (
                why.found.map((skill) => (
                  <span key={skill} className="inline-flex items-center gap-1 rounded-full bg-success-muted px-2.5 py-1 text-xs font-medium text-success ring-1 ring-inset ring-success/20">
                    <Check className="size-3" strokeWidth={3} />
                    {skill}
                  </span>
                ))
              )}
            </dd>
          </div>
          {why.absent.length > 0 && (
            <div>
              <dt className="text-muted-foreground">Not mentioned</dt>
              <dd className="mt-2 flex flex-wrap gap-1.5">
                {why.absent.map((skill) => (
                  <span key={skill} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-subtle-foreground ring-1 ring-inset ring-border">
                    {skill}
                  </span>
                ))}
              </dd>
            </div>
          )}
          <div className="flex items-center gap-2 text-muted-foreground">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full",
                why.roleInTitle ? "bg-success-muted text-success" : "bg-surface-2 text-subtle-foreground"
              )}
            >
              {why.roleInTitle ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" />}
            </span>
            {why.roleInTitle
              ? `The title matches your target role (${targetRole}).`
              : `The title doesn't name your target role (${targetRole}).`}
          </div>
        </dl>
      </section>

      {job.tags.length > 0 && (
        <section>
          <p className="type-eyebrow text-subtle-foreground">Listing tags</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {job.tags.slice(0, 12).map((tag) => (
              <span key={tag} className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {description && (
        <section>
          <p className="type-eyebrow text-subtle-foreground">About the role</p>
          <p className={cn("mt-2.5 text-sm leading-relaxed text-muted-foreground", !expanded && "line-clamp-6")}>
            {description}
          </p>
          {description.length > 420 && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        {job.url && (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: "lg" })}
          >
            Open listing
            <ArrowUpRight />
          </a>
        )}
        <p className="text-xs text-subtle-foreground">Opens on {job.source}</p>
      </div>
    </article>
  )
}

function JobsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
      <div className="hidden space-y-4 lg:block">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-8 h-16 w-40" />
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
    </div>
  )
}

export default function JobsPage() {
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const [jobs, setJobs] = useState<ApiJob[]>([])
  const [skills, setSkills] = useState<string[]>([])
  const [targetRole, setTargetRole] = useState("your target role")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  // The location searched (location) and the one being typed (locationDraft).
  const [location, setLocation] = useState("")
  const [locationDraft, setLocationDraft] = useState("")
  const [locationError, setLocationError] = useState("")
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [sources, setSources] = useState<string[]>([])

  async function loadJobs(searchLocation: string) {
    try {
      setLoading(true)
      setError("")

      const response = await fetch(jobsApiUrl(searchLocation), {
        cache: "no-store",
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Unable to load jobs")
      }

      setTargetRole(data.targetRole || "your target role")
      setRemoteOnly(Boolean(data.location?.remoteOnly))
      setSources(Array.isArray(data.sources) ? data.sources.filter((s: unknown): s is string => typeof s === "string") : [])
      setSkills(Array.isArray(data.skills) ? data.skills.filter((s: unknown): s is string => typeof s === "string") : [])
      setJobs(
        (Array.isArray(data.jobs) ? data.jobs : []).map((job: ApiJob) => ({
          ...job,
          tags: Array.isArray(job.tags) ? job.tags : [],
        }))
      )
    } catch (err) {
      console.error("Jobs page error:", err)
      setError("Unable to load live job recommendations.")
      setJobs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const saved = readJobLocation()
    setLocation(saved)
    setLocationDraft(saved)
    loadJobs(saved)
  }, [])

  function searchLocation(event: React.FormEvent) {
    event.preventDefault()
    const next = sanitizeJobLocation(locationDraft)
    if (!next) {
      setLocationError('Enter a place name, such as "Pune, India", "London, UK" or "Remote".')
      return
    }
    setLocationError("")
    setLocation(next)
    setLocationDraft(next)
    setSelectedId(null)
    saveJobLocation(next)
    loadJobs(next)
  }

  // None of the listings is in the searched city itself.
  const noneInCity = !remoteOnly && jobs.length > 0 && !jobs.some((job) => job.locationMatch === "city")
  const cityName = location.split(",")[0]?.trim() || location

  const visibleJobs = useMemo(() => {
    return jobs
      .filter((job) => {
        if (filter === "ready") return job.match >= 75
        if (filter === "stretch") return job.match < 75
        return true
      })
      .filter((job) => {
        const q = query.trim().toLowerCase()

        if (!q) return true

        return (
          job.title.toLowerCase().includes(q) ||
          job.company.toLowerCase().includes(q) ||
          job.tags.some((tag) => tag.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => {
        if (b.locationScore !== a.locationScore) {
          return b.locationScore - a.locationScore
        }
        return b.match - a.match
      })
  }, [jobs, filter, query])

  // Keep a selection that is visible; default to the first result.
  const selected =
    visibleJobs.find((job) => job.id === selectedId) ?? visibleJobs[0] ?? null

  function openJob(job: ApiJob) {
    setSelectedId(job.id)
    if (window.matchMedia("(max-width: 1023px)").matches) setSheetOpen(true)
  }

  const counts = {
    all: jobs.length,
    ready: jobs.filter((job) => job.match >= 75).length,
    stretch: jobs.filter((job) => job.match < 75).length,
  }

  return (
    <div>
      <PageHeader
        eyebrow={<Eyebrow tone="primary">Step 4 · Apply</Eyebrow>}
        title="Jobs"
        description={
          remoteOnly
            ? `Live remote openings for ${targetRole}, ranked by how well each listing matches your profile.`
            : `Live openings for ${targetRole} in ${location || "your chosen location"}: that city first, then nearby and remote roles, each ranked by how well it matches your profile.`
        }
        actions={
          <button
            type="button"
            onClick={() => loadJobs(location)}
            disabled={loading}
            className={buttonVariants({ variant: "secondary" })}
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
            Refresh
          </button>
        }
      />

      {/* Where to search */}
      <form onSubmit={searchLocation} className="mb-4">
        <label htmlFor="job-location" className="type-eyebrow mb-2 block text-subtle-foreground">
          Search jobs in
        </label>
        <div className="flex gap-2">
          <div className="relative w-full md:max-w-sm">
            <MapPin className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
            <input
              id="job-location"
              list="job-location-options"
              value={locationDraft}
              onChange={(e) => setLocationDraft(e.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="City, country or Remote"
              aria-invalid={locationError ? true : undefined}
              aria-describedby={locationError ? "job-location-error" : undefined}
              className="h-10 w-full rounded-xl border border-border-strong bg-[oklch(0.13_0.01_262/60%)] pl-10 pr-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-subtle-foreground focus:border-primary/60 focus:shadow-[0_0_0_4px_oklch(0.72_0.135_250/12%)]"
            />
            <datalist id="job-location-options">
              {JOB_LOCATION_SUGGESTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
          <button type="submit" disabled={loading} className={buttonVariants({ variant: "default" })}>
            <Search />
            Search
          </button>
        </div>
        {locationError && (
          <p id="job-location-error" className="mt-2 text-xs text-destructive">
            {locationError}
          </p>
        )}
      </form>

      {/* Toolbar */}
      <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
          <label htmlFor="job-search" className="sr-only">Search jobs</label>
          <input
            id="job-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, company or tag"
            className="h-10 w-full rounded-xl border border-border-strong bg-[oklch(0.13_0.01_262/60%)] pl-10 pr-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-subtle-foreground focus:border-primary/60 focus:shadow-[0_0_0_4px_oklch(0.72_0.135_250/12%)]"
          />
        </div>

        <div
          role="group"
          aria-label="Filter by match"
          className="flex gap-1 overflow-x-auto rounded-xl bg-[oklch(0.13_0.01_262/60%)] p-1 ring-1 ring-inset ring-border"
        >
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                "pressable flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium",
                filter === f.id
                  ? "bg-surface-2 text-foreground ring-1 ring-inset ring-border-strong"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="sm:hidden">{f.short}</span>
              <span className="hidden sm:inline">{f.label}</span>
              {!loading && <span className="tabular-nums text-subtle-foreground">{counts[f.id]}</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingState title="Finding relevant opportunities…" description="Fetching live openings and ranking them against your profile.">
          <JobsSkeleton />
        </LoadingState>
      ) : error ? (
        <ErrorState
          title="Jobs couldn't load"
          description={`${error} The job boards may be unavailable; try again in a moment.`}
          onRetry={() => loadJobs(location)}
        />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={`No openings for ${location}`}
          description="The job sources have no listings there right now. Try a nearby city, the country, or Remote."
        />
      ) : visibleJobs.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No jobs match these filters"
          description="Try a different search or filter."
          action={
            <button
              type="button"
              onClick={() => {
                setQuery("")
                setFilter("all")
              }}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <>
        {noneInCity && (
          <Notice tone="info" title={`No listings in ${cityName} right now`} className="mb-6">
            The job sources have none there today, so these are openings elsewhere in the
            country and remote roles open to it.
          </Notice>
        )}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* List */}
          <div>
            <p className="mb-3 text-xs text-subtle-foreground">
              {visibleJobs.length} of {jobs.length} openings
            </p>
            <ul className="divide-y divide-border border-y border-border">
              {visibleJobs.map((job) => {
                const active = selected?.id === job.id
                return (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => openJob(job)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "group relative flex w-full items-center gap-4 px-3 py-4 text-left transition-colors",
                        active ? "bg-surface-2/70" : "hover:bg-surface-2/40"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-y-2 left-0 w-0.5 rounded-full transition-colors",
                          active ? "bg-primary" : "bg-transparent"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-sm font-medium", active ? "text-foreground" : "text-foreground/90 group-hover:text-foreground")}>
                          {job.title}
                        </p>
                        <p className="mt-1 truncate text-xs text-subtle-foreground">
                          {job.company} · {locationLabel(job)}
                        </p>
                      </div>
                      <MatchMeter value={job.match} className="shrink-0" />
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="mt-6 text-xs text-subtle-foreground">
              Listings come from public job boards
              {sources.length ? ` (${sources.join(", ")})` : ""}. Availability and freshness
              depend on the source.
            </p>
          </div>

          {/* Detail (desktop) */}
          <div className="hidden lg:block">
            <div className="sticky top-10 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-2xl border border-border bg-card p-7">
              {selected && <JobDetail key={selected.id} job={selected} skills={skills} targetRole={targetRole} />}
            </div>
          </div>
        </div>
        </>
      )}

      {/* Detail (phones and tablets): a sheet that rises from the bottom and returns there. */}
      <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/55 transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 lg:hidden" />
          <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-3xl border-t border-border-strong bg-card outline-none transition-transform duration-300 ease-[var(--ease-out)] data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full lg:hidden">
            <div className="flex items-center justify-between px-5 pb-2 pt-3">
              <span className="mx-auto h-1 w-10 rounded-full bg-border-strong" aria-hidden="true" />
            </div>
            <div className="flex items-center justify-between px-5">
              <Dialog.Title className="type-eyebrow text-subtle-foreground">Job details</Dialog.Title>
              <Dialog.Close
                aria-label="Close job details"
                className="pressable flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <X className="size-5" />
              </Dialog.Close>
            </div>
            <div className="overflow-y-auto px-5 pb-8 pt-4">
              {selected && <JobDetail key={selected.id} job={selected} skills={skills} targetRole={targetRole} />}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
