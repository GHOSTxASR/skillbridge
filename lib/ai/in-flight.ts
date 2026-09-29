// Lets identical concurrent requests share one piece of work (one Groq call) instead of
// each starting their own, e.g. React Strict Mode mounting a page twice in development.
//
// Limits: it only covers requests handled by the same server process (the dev server, or
// one serverless instance); it is not a cache (entries are removed as soon as the work
// settles) and not shared between instances. Persistent caches still do the real saving.

const MAX_ENTRIES = 100

// An entry older than this is not joined; the work behind it has its own timeout.
const STALE_MS = 60_000

const inFlight = new Map<string, { promise: Promise<unknown>; startedAt: number }>()

export function shareInFlight<T>(
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const now = Date.now()
  const existing = inFlight.get(key)

  if (existing && now - existing.startedAt < STALE_MS) {
    return existing.promise as Promise<T>
  }

  if (existing) inFlight.delete(key)

  // Never grow without bound: past the cap, work simply runs unshared.
  if (inFlight.size >= MAX_ENTRIES) return work()

  const promise: Promise<T> = work().finally(() => {
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key)
  })

  inFlight.set(key, { promise, startedAt: now })

  return promise
}

export function inFlightCount(): number {
  return inFlight.size
}
