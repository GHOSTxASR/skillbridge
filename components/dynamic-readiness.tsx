"use client"

import { supabase } from "@/lib/supabase-browser"

import { useEffect, useState } from "react"
import { ReadinessRing } from "@/components/readiness-ring"

export function DynamicReadiness({ fallback = 68 }: { fallback?: number }) {
  const [readiness, setReadiness] = useState(fallback)

  useEffect(() => {
    async function loadAssessment() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) return

        const saved = localStorage.getItem(`skillbridge-assessment-result-${user.id}`)

        if (saved) {
          const result = JSON.parse(saved)

          if (typeof result.readiness === "number") {
            setReadiness(result.readiness)
          }
        }
      } catch {
        // Keep fallback if saved data is invalid
      }
    }

    loadAssessment()
  }, [])

  return <ReadinessRing value={readiness} size={150} />
}






