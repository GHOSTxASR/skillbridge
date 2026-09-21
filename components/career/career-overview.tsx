"use client"

import { useEffect, useState } from "react"
import { getAssessment, calculateJobReadiness } from "@/lib/skillbridge/career-data"

export function CareerOverview() {
  const [ready, setReady] = useState(false)
  const [score, setScore] = useState(0)
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    const assessment = getAssessment()

    if (assessment) {
      setCompleted(true)
      setScore(calculateJobReadiness())
    }

    setReady(true)
  }, [])

  if (!ready) return null

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Career Progress</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Your SkillBridge assessment progress
          </p>
        </div>

        <div className="text-right">
          <p className="text-2xl font-bold">{score}%</p>
          <p className="text-xs text-muted-foreground">Readiness</p>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${score}%` }}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {completed
          ? "Assessment completed. Your career data is ready."
          : "Complete your skill assessment to generate your personalized career insights."}
      </p>
    </div>
  )
}
