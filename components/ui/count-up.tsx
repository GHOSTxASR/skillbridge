"use client"

import { useEffect, useRef, useState } from "react"

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

// Counts from the value currently on screen to the new one (never restarts from 0
// on an update), easing out. Shows the final value at once under reduced motion.
export function CountUp({
  value,
  duration = 900,
  className,
}: {
  value: number
  duration?: number
  className?: string
}) {
  const [display, setDisplay] = useState(0)
  const shown = useRef(0)

  useEffect(() => {
    const from = shown.current
    const to = Math.round(value)

    if (from === to) return

    if (prefersReducedMotion()) {
      shown.current = to
      setDisplay(to)
      return
    }

    let frame = 0
    const start = performance.now()

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = Math.round(from + (to - from) * eased)

      shown.current = next
      setDisplay(next)

      if (t < 1) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  return (
    <span className={className} aria-label={String(Math.round(value))}>
      <span aria-hidden="true">{display}</span>
    </span>
  )
}
