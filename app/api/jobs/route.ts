import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import {
  DEFAULT_JOB_LOCATION,
  LOCATION_SCORE,
  classifyJobLocation,
  parseJobLocation,
  sanitizeJobLocation,
  type LocationMatch,
} from "@/lib/jobs/location"
import {
  arbeitnowCovers,
  fetchArbeitnow,
  fetchMuse,
  fetchRemotive,
  type SourceJob,
} from "@/lib/jobs/providers"
import { applyDemoJobLocation, isDemoJobLocationMode } from "@/lib/jobs/demo-location-adapter" // TEMPORARY DEMO WORKAROUND — REMOVE AFTER SIH DEMO

type Job = {
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
  locationMatch: LocationMatch
}

const MAX_JOBS = 60

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\w+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function calculateMatch(
  title: string,
  description: string,
  tags: string[],
  targetRole: string,
  skills: string[]
) {
  const text = normalize(
    `${title} ${description} ${tags.join(" ")}`
  )

  const role = normalize(targetRole)

  let skillMatches = 0

  for (const skill of skills) {
    const normalizedSkill = normalize(skill)

    if (
      normalizedSkill &&
      text.includes(normalizedSkill)
    ) {
      skillMatches++
    }
  }

  const skillScore = skills.length
    ? (skillMatches / skills.length) * 70
    : 0

  const roleScore =
    role &&
    (normalize(title).includes(role) ||
      role.includes(normalize(title)))
      ? 30
      : 0

  return Math.min(
    100,
    Math.round(skillScore + roleScore)
  )
}

export async function GET(request: Request) {
  try {
    const supabase =
      await createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        {
          error: "Authentication required",
        },
        { status: 401 }
      )
    }

    const {
      data: profile,
      error: profileError,
    } = await supabase
      .from("profiles")
      .select("target_role, skills")
      .eq("id", user.id)
      .single()

    if (profileError) {
      console.error(
        "Job profile error:",
        profileError
      )
    }

    const targetRole =
      profile?.target_role?.trim() ||
      "Software Engineer"

    let skills: string[] = []

    if (Array.isArray(profile?.skills)) {
      skills = profile.skills
        .map((skill: unknown) =>
          String(skill).trim()
        )
        .filter(Boolean)
    } else if (
      typeof profile?.skills === "string"
    ) {
      skills = profile.skills
        .split(",")
        .map((skill: string) =>
          skill.trim()
        )
        .filter(Boolean)
    }

    // Where to search: ?location=..., else the default. Anything that is not a plain
    // place name is ignored rather than sent on to a job source.
    const requested = new URL(request.url).searchParams.get("location")
    const target = parseJobLocation(
      sanitizeJobLocation(requested) ?? DEFAULT_JOB_LOCATION
    )

    const [museJobs, remotiveJobs, arbeitnowJobs] = await Promise.all([
      fetchMuse(target, targetRole),
      fetchRemotive(),
      arbeitnowCovers(target) ? fetchArbeitnow() : Promise.resolve([] as SourceJob[]),
    ])

    const summary: Record<LocationMatch, number> = {
      city: 0,
      country: 0,
      remote: 0,
      other: 0,
    }

    const jobs: Job[] = []

    for (const job of [...museJobs, ...arbeitnowJobs, ...remotiveJobs]) {
      if (!job.title || !job.url) continue

      const locationMatch = classifyJobLocation(job.location, job.remote, target)

      // Listings somewhere the user did not ask for are left out (and counted).
      if (locationMatch === "other") {
        summary.other++
        continue
      }

      jobs.push({
        ...job,
        location:
          job.source === "Remotive" && job.location.toLowerCase() === "india"
            ? "India · Remote"
            : job.location,
        match: calculateMatch(job.title, job.description, job.tags, targetRole, skills),
        locationScore: LOCATION_SCORE[locationMatch],
        locationMatch,
      })
    }

    const uniqueJobs =
      Array.from(
        new Map(
          jobs.map((job) => [
            job.url,
            job,
          ])
        ).values()
      )

    for (const job of uniqueJobs) summary[job.locationMatch]++

    uniqueJobs.sort(
      (a, b) => {
        const aScore =
          a.locationScore * 2 +
          a.match

        const bScore =
          b.locationScore * 2 +
          b.match

        return bScore - aScore
      }
    )

    let ranked = uniqueJobs.slice(0, MAX_JOBS)

    if (isDemoJobLocationMode()) ranked = applyDemoJobLocation(ranked, target) // TEMPORARY DEMO WORKAROUND — REMOVE AFTER SIH DEMO

    return NextResponse.json({
      userId: user.id,
      targetRole,
      preferredLocation: target.label,
      location: {
        label: target.label,
        remoteOnly: target.remoteOnly,
        // Listings per fit, from the sources (before any demo relabelling);
        // `other` were elsewhere and left out.
        matches: summary,
      },
      skills,
      jobs: ranked,
      total: uniqueJobs.length,
      sources: [
        "The Muse",
        "Remotive",
        ...(arbeitnowCovers(target) ? ["Arbeitnow"] : []),
      ],
      generatedAt:
        new Date().toISOString(),
      freshness:
        `Live listings for ${target.label}: that city first, then elsewhere in the country, then remote roles open to it.`,
    })
  } catch (error) {
    console.error(
      "Jobs API error:",
      error
    )

    return NextResponse.json(
      {
        error:
          "Unable to load jobs",
      },
      { status: 500 }
    )
  }
}
