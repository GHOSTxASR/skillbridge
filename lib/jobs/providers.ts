import type { JobLocationTarget } from "@/lib/jobs/location"

// Free, keyless job sources used by /api/jobs, and the listing shape they share.
//
// Arbeitnow (arbeitnow.com/api/job-board-api): European boards only, ~325 listings per
//   page, ~2.8 MB. Ignores location/search parameters, so it is only requested for
//   European or remote searches.
// Remotive (remotive.com/api/remote-jobs): remote-only; the free feed is a fixed sample
//   (search/category are ignored) and asks for at most ~4 requests a day.
// The Muse (themuse.com/api/public/jobs): filters by `location` (its own city spelling,
//   e.g. "Bangalore, India") and `category`; 20 per page; 500 requests/hour per IP.

export type SourceJob = {
  id: string
  title: string
  company: string
  location: string
  remote: boolean
  description: string
  url: string
  source: string
  tags: string[]
}

const ARBEITNOW_URL = "https://www.arbeitnow.com/api/job-board-api"
const REMOTIVE_URL = "https://remotive.com/api/remote-jobs"
const MUSE_URL = "https://www.themuse.com/api/public/jobs"

const ARBEITNOW_TTL_MS = 15 * 60 * 1000
const REMOTIVE_REVALIDATE_S = 6 * 60 * 60
const MUSE_REVALIDATE_S = 30 * 60
const MUSE_PAGES = 2

type Json = Record<string, unknown>

async function getJson(url: string, init: RequestInit & { next?: { revalidate: number } }) {
  try {
    const response = await fetch(url, { ...init, headers: { Accept: "application/json" } })
    if (!response.ok) return null
    return (await response.json()) as Json
  } catch {
    return null
  }
}

// Responses kept in this server process, keyed by full URL. The Muse URL carries the
// location, so "Kolkata" and "London" are separate entries and never share results.
// Concurrent requests for the same URL share one download; failures are not kept.
const MAX_CACHED_URLS = 200
const responseCache = new Map<string, { expires: number; data: Promise<Json | null> }>()

function getJsonCached(url: string, ttlSeconds: number): Promise<Json | null> {
  const now = Date.now()
  const hit = responseCache.get(url)
  if (hit && hit.expires > now) return hit.data

  const data = getJson(url, { next: { revalidate: ttlSeconds } }).then((json) => {
    if (!json) responseCache.delete(url)
    return json
  })

  responseCache.delete(url)
  responseCache.set(url, { expires: now + ttlSeconds * 1000, data })
  // Oldest entries go first once the cache is full.
  while (responseCache.size > MAX_CACHED_URLS) {
    responseCache.delete(responseCache.keys().next().value as string)
  }
  return data
}

// Arbeitnow's page is larger than the 2 MB Next.js data cache accepts, so that cache
// never stored it and every request downloaded it again. Keep the parsed listings in
// memory instead, and share one download between concurrent requests.
let arbeitnowCache: { expires: number; jobs: Promise<SourceJob[]> } | null = null

export function fetchArbeitnow(): Promise<SourceJob[]> {
  const now = Date.now()
  if (arbeitnowCache && arbeitnowCache.expires > now) return arbeitnowCache.jobs

  const jobs = getJson(ARBEITNOW_URL, { cache: "no-store" }).then((data) => {
    const rows = Array.isArray(data?.data) ? (data.data as Json[]) : []
    const list = rows.map((job): SourceJob => ({
      id: `arbeitnow-${String(job.slug ?? job.url ?? "")}`,
      title: String(job.title ?? ""),
      company: String(job.company_name ?? "Unknown Company"),
      location: String(job.location ?? "") || (job.remote ? "Remote" : ""),
      remote: Boolean(job.remote),
      description: String(job.description ?? ""),
      url: String(job.url ?? ""),
      source: "Arbeitnow",
      tags: Array.isArray(job.tags) ? job.tags.map((tag) => String(tag)) : [],
    }))
    // A failed download is not cached, so the next request tries again.
    if (!list.length) arbeitnowCache = null
    return list
  })

  arbeitnowCache = { expires: now + ARBEITNOW_TTL_MS, jobs }
  return jobs
}

export async function fetchRemotive(): Promise<SourceJob[]> {
  const data = await getJsonCached(REMOTIVE_URL, REMOTIVE_REVALIDATE_S)
  const rows = Array.isArray(data?.jobs) ? (data.jobs as Json[]) : []

  return rows.map((job): SourceJob => ({
    id: `remotive-${String(job.id ?? job.url ?? "")}`,
    title: String(job.title ?? ""),
    company: String(job.company_name ?? "Unknown Company"),
    location: String(job.candidate_required_location ?? "") || "Remote",
    remote: true,
    description: String(job.description ?? ""),
    url: String(job.url ?? ""),
    source: "Remotive",
    tags: Array.isArray(job.tags) ? job.tags.map((tag) => String(tag)) : [],
  }))
}

// The Muse's categories that hold each kind of role.
export function museCategoriesForRole(role: string): string[] {
  const value = role.toLowerCase()
  if (/\bdata\b|analyst|scientist|machine learning|\bml\b|\bai\b/.test(value)) {
    return ["Data and Analytics", "Software Engineering"]
  }
  if (/security|cyber|devops|cloud|infrastructure|network|\bit\b|sysadmin/.test(value)) {
    return ["Software Engineering", "Computer and IT"]
  }
  return ["Software Engineering"]
}

function museJob(job: Json): SourceJob {
  const places = Array.isArray(job.locations)
    ? (job.locations as Json[]).map((place) => String(place.name ?? "")).filter(Boolean)
    : []
  const remote = places.some((place) => /flexible|remote/i.test(place))
  const onsite = places.filter((place) => !/flexible|remote/i.test(place))
  const labels = [
    ...(Array.isArray(job.categories) ? (job.categories as Json[]) : []),
    ...(Array.isArray(job.levels) ? (job.levels as Json[]) : []),
  ].map((item) => String(item.name ?? "")).filter(Boolean)
  const refs = (job.refs ?? {}) as Json
  const company = (job.company ?? {}) as Json

  return {
    id: `themuse-${String(job.id ?? refs.landing_page ?? "")}`,
    title: String(job.name ?? ""),
    company: String(company.name ?? "Unknown Company"),
    location: onsite.join(" · ") || (remote ? "Remote" : ""),
    remote,
    description: String(job.contents ?? ""),
    url: String(refs.landing_page ?? ""),
    source: "The Muse",
    tags: labels,
  }
}

async function fetchMusePages(locations: string[], categories: string[]): Promise<SourceJob[]> {
  if (!locations.length) return []

  const pages = await Promise.all(
    Array.from({ length: MUSE_PAGES }, (_, page) => {
      const url = new URL(MUSE_URL)
      url.searchParams.set("page", String(page))
      for (const location of locations) url.searchParams.append("location", location)
      for (const category of categories) url.searchParams.append("category", category)
      return getJsonCached(url.toString(), MUSE_REVALIDATE_S)
    })
  )

  return pages.flatMap((data) =>
    Array.isArray(data?.results) ? (data.results as Json[]).map(museJob) : []
  )
}

// The Muse returns remote listings alongside the requested places, so the city and its
// country are requested separately: the city's own listings are not crowded out.
export async function fetchMuse(target: JobLocationTarget, role: string): Promise<SourceJob[]> {
  const categories = museCategoriesForRole(role)
  const [city, country] = await Promise.all([
    fetchMusePages(target.museCityLocations, categories),
    fetchMusePages(target.museCountryLocations, categories),
  ])
  return [...city, ...country]
}

// Arbeitnow only lists European jobs; skip its 2.8 MB download for other searches.
export function arbeitnowCovers(target: JobLocationTarget): boolean {
  return target.remoteOnly || target.region === "emea"
}
