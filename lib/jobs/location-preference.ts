import { DEFAULT_JOB_LOCATION, sanitizeJobLocation } from "@/lib/jobs/location"

// The location the Jobs page searches in, remembered on this device. The Jobs page and
// the dashboard's opportunities both read it, so they always show the same place.
const STORAGE_KEY = "skillbridge-job-location"

export function readJobLocation(): string {
  try {
    return sanitizeJobLocation(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_JOB_LOCATION
  } catch {
    return DEFAULT_JOB_LOCATION
  }
}

export function saveJobLocation(location: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, location)
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

export function jobsApiUrl(location: string): string {
  return `/api/jobs?location=${encodeURIComponent(location)}`
}
