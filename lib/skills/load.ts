// Client-side reads for the Skills pages: one GET, no retries or polling of its own.
// A failed read keeps only its HTTP status (null when there was no response), so pages
// can tell "could not load" apart from "loaded and empty" without showing server text.

export type Load<T> =
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "error"; status: number | null }

export async function getJson<T>(
  url: string,
  read: (body: unknown) => T | null,
  signal: AbortSignal
): Promise<Load<T>> {
  try {
    const response = await fetch(url, { cache: "no-store", signal })
    if (!response.ok) return { state: "error", status: response.status }
    const data = read(await response.json().catch(() => null))
    return data ? { state: "ready", data } : { state: "error", status: null }
  } catch (error) {
    if (signal.aborted) throw error
    return { state: "error", status: null }
  }
}

// What went wrong, in the user's terms. Server messages and codes are not shown.
export function failureText(status: number | null) {
  if (status === null) return "Check your connection and try again."
  if (status === 503) return "The skill catalogue is temporarily unavailable. Try again in a moment."
  return "Something went wrong on our side. Try again in a moment."
}
