// TEMPORARY DEMO WORKAROUND
// REMOVE AFTER SIH DEMO
// NOT FOR PRODUCTION
//
// Off unless the server runs with DEMO_JOB_LOCATION_MODE=true.
//
// The free job sources have no listings in some cities (Kolkata has none on any of
// them). For the demo recording only, when the searched city has fewer than 5 real
// listings, on-site listings from elsewhere in the searched country are shown at the
// searched location. Nothing else is changed: title, company,
// description, tags, match and URL stay as the source sent them, the source's own
// location is kept in `demo.sourceLocation`, and nothing is stored anywhere. Remote
// listings and listings already in the searched city are left alone.
//
// To remove: delete this file, the two lines marked "TEMPORARY DEMO WORKAROUND" in
// app/api/jobs/route.ts (the import and the call), and the
// DEMO_JOB_LOCATION_MODE entry in .env.local.

import { LOCATION_SCORE, type JobLocationTarget, type LocationMatch } from "@/lib/jobs/location"

export function isDemoJobLocationMode(): boolean {
  return process.env.DEMO_JOB_LOCATION_MODE === "true"
}

type RankedJob = {
  location: string
  remote: boolean
  locationMatch: LocationMatch
  locationScore: number
}

// Cities with at least this many real listings are shown exactly as the sources sent them.
const MIN_REAL_CITY_LISTINGS = 5

export function applyDemoJobLocation<T extends RankedJob>(
  jobs: T[],
  target: JobLocationTarget
): (T & { demo?: { sourceLocation: string; sourceLocationMatch: LocationMatch } })[] {
  if (target.remoteOnly || !target.city) return jobs

  const realCityListings = jobs.filter((job) => job.locationMatch === "city").length
  if (realCityListings >= MIN_REAL_CITY_LISTINGS) return jobs

  return jobs.map((job) => {
    if (job.remote || job.locationMatch !== "country") return job

    return {
      ...job,
      location: target.label,
      locationMatch: "city" as const,
      locationScore: LOCATION_SCORE.city,
      demo: { sourceLocation: job.location, sourceLocationMatch: job.locationMatch },
    }
  })
}
