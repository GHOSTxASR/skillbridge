"use client"

import { useEffect, useId, useState } from "react"
import { cn } from "@/lib/utils"
import { CountUp } from "@/components/ui/count-up"

// A 270-degree readiness arc. It draws from the value currently shown to the new
// value, and has an explicit empty state instead of pretending to show 0%.
export function ReadinessGauge({
  value,
  size = 176,
  stroke = 12,
  label = "ready",
  className,
}: {
  value: number | null
  size?: number
  stroke?: number
  label?: string
  className?: string
}) {
  const id = useId()
  const [drawn, setDrawn] = useState(0)

  const hasValue = typeof value === "number" && Number.isFinite(value)
  const pct = hasValue ? Math.max(0, Math.min(100, value)) : 0

  useEffect(() => {
    // Next frame, so the arc animates in from the value already drawn.
    const frame = requestAnimationFrame(() => setDrawn(pct))
    return () => cancelAnimationFrame(frame)
  }, [pct])

  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const arc = circumference * 0.75
  const offset = arc * (1 - drawn / 100)

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={hasValue ? `${Math.round(pct)}% ${label}` : "Not analyzed yet"}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="var(--primary)" />
            <stop offset="1" stopColor="var(--ai)" />
          </linearGradient>
        </defs>
        <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="oklch(1 0 0 / 8%)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference}`}
          />
          {hasValue && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={`url(#${id}-g)`}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${arc} ${circumference}`}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 1100ms var(--ease-out)" }}
            />
          )}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {hasValue ? (
          <>
            <span
              className="type-metric text-foreground"
              style={{ fontSize: size * 0.24 }}
            >
              <CountUp value={pct} />
              <span className="text-[0.5em] font-medium text-muted-foreground">%</span>
            </span>
            <span className="mt-1.5 text-xs font-medium text-muted-foreground">
              {label}
            </span>
          </>
        ) : (
          <>
            <span className="type-metric text-subtle-foreground" style={{ fontSize: size * 0.2 }}>
              —
            </span>
            <span className="mt-1.5 text-xs text-subtle-foreground">not analyzed</span>
          </>
        )}
      </div>
    </div>
  )
}
