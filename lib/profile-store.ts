"use client"

import { useEffect, useSyncExternalStore } from "react"
import { isAuthRetryableFetchError } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase-browser"

// The signed-in user's saved profile, for the app shell (sidebar identity, assistant
// context). One own-row read per session (RLS limits it to the user); pages that save
// the profile call refreshShellProfile() so the shell never shows stale details.

export type ShellProfile = {
  id: string
  email: string
  name: string
  targetRole: string
  experience: string
  skills: string[]
}

export type ShellProfileState = {
  status: "idle" | "loading" | "ready" | "missing" | "signed-out" | "error"
  profile: ShellProfile | null
}

let state: ShellProfileState = { status: "idle", profile: null }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null

function setState(next: ShellProfileState) {
  state = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// profiles.skills is an array (assessment) or a comma-separated string (account page).
export function parseSkills(value: unknown): string[] {
  const items =
    typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : []

  const seen = new Set<string>()
  const skills: string[] = []

  for (const item of items) {
    if (typeof item !== "string") continue
    const skill = item.trim()
    if (!skill || seen.has(skill.toLowerCase())) continue
    seen.add(skill.toLowerCase())
    skills.push(skill)
  }

  return skills
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isRetryableAuthError(error: unknown) {
  return isAuthRetryableFetchError(error) || (error instanceof Error && error.name === "AuthRetryableFetchError")
}

export function loadShellProfile(force = false): Promise<void> {
  if (inflight) return inflight
  if (!force && state.status !== "idle" && state.status !== "error") {
    return Promise.resolve()
  }

  if (!state.profile) setState({ status: "loading", profile: null })

  inflight = (async () => {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (!user) {
        // A network or server failure is not a sign-out (the app shell would send the
        // user to /login); only a missing or rejected session is.
        setState(
          isRetryableAuthError(userError)
            ? { status: "error", profile: state.profile }
            : { status: "signed-out", profile: null }
        )
        return
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("name, target_role, experience_level, skills")
        .eq("id", user.id)
        .maybeSingle()

      const metadataName =
        text(user.user_metadata?.name) || text(user.user_metadata?.full_name)

      if (error) {
        setState({ status: "error", profile: state.profile })
        return
      }

      const profile: ShellProfile = {
        id: user.id,
        email: user.email ?? "",
        name: text(data?.name) || metadataName,
        targetRole: text(data?.target_role),
        experience: text(data?.experience_level),
        skills: parseSkills(data?.skills),
      }

      setState({ status: data ? "ready" : "missing", profile })
    } catch {
      setState({ status: "error", profile: state.profile })
    } finally {
      inflight = null
    }
  })()

  return inflight
}

export function refreshShellProfile() {
  return loadShellProfile(true)
}

export function resetShellProfile() {
  setState({ status: "idle", profile: null })
}

export function useShellProfile(): ShellProfileState {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  )

  useEffect(() => {
    loadShellProfile()
  }, [])

  return snapshot
}
