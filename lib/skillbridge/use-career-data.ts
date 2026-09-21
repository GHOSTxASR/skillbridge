"use client"

import { useEffect, useState } from "react"
import {
  getAssessment,
  getSkillGaps,
  getRoadmap,
  calculateJobReadiness,
  type AssessmentResult,
  type SkillGap,
  type RoadmapItem,
} from "@/lib/skillbridge/career-data"

export function useCareerData() {
  const [assessment, setAssessment] = useState<AssessmentResult | null>(null)
  const [gaps, setGaps] = useState<SkillGap[]>([])
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([])
  const [readiness, setReadiness] = useState(0)

  function refresh() {
    setAssessment(getAssessment())
    setGaps(getSkillGaps())
    setRoadmap(getRoadmap())
    setReadiness(calculateJobReadiness())
  }

  useEffect(() => {
    refresh()
  }, [])

  return {
    assessment,
    gaps,
    roadmap,
    readiness,
    refresh,
  }
}
