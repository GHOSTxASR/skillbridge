"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase-browser"
import { gateDecision } from "@/lib/auth/flow"
import { resetShellProfile, useShellProfile } from "@/lib/profile-store"

const SETUP_PROFILE_PATH = "/setup-profile"

// Renders the page only for a signed-in user, and, unless requireProfile is false, only once
// that user's profiles row is known to exist. A signed-in user without a profile (verified
// but never onboarded, or who closed the tab before finishing) is sent to /setup-profile
// before any page content, and so any of its data requests, runs. The profile comes from
// the shell's own-row read (lib/profile-store.ts), so the check costs no extra request.
// Profiles are only ever created by /setup-profile; nothing here writes one.
export function AuthGuard({
  children,
  requireProfile = true,
}: {
  children: React.ReactNode
  requireProfile?: boolean
}) {
  const router = useRouter()
  const { status } = useShellProfile()
  const decision = gateDecision(status, requireProfile)

  useEffect(() => {
    if (decision === "login") router.replace("/login")
    else if (decision === "setup") router.replace(SETUP_PROFILE_PATH)
  }, [decision, router])

  // Signed out here or in another tab: leave the app.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        resetShellProfile()
        router.replace("/login")
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

  if (decision !== "allow") {
    return (
      <div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center">
        <Loader2 aria-hidden="true" className="size-5 animate-spin text-subtle-foreground" />
        <span className="sr-only">
          {decision === "setup" ? "Taking you to profile setup…" : "Loading your account…"}
        </span>
      </div>
    )
  }

  return <>{children}</>
}
