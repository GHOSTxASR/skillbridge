"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

type Tone = "primary" | "success" | "warning" | "danger" | "ai"

const toneStyles: Record<Tone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  ai: "bg-ai",
}

// Fills from the width currently drawn to the new value.
export function ProgressBar({
  value,
  max = 100,
  tone = "primary",
  showLabel = false,
  label,
  size = "md",
  className,
}: {
  value: number
  max?: number
  tone?: Tone
  showLabel?: boolean
  label?: string
  size?: "sm" | "md"
  className?: string
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const [drawn, setDrawn] = useState(0)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(pct))
    return () => cancelAnimationFrame(frame)
  }, [pct])

  return (
    <div className={cn("w-full", className)}>
      {(showLabel || label) && (
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground">{label}</span>
          {showLabel && (
            <span className="font-semibold text-foreground tabular-nums">
              {Math.round(pct)}%
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          "w-full overflow-hidden rounded-full bg-[oklch(1_0_0/7%)]",
          size === "sm" ? "h-1.5" : "h-2",
        )}
      >
        <div
          className={cn("h-full rounded-full", toneStyles[tone])}
          style={{
            width: `${drawn}%`,
            transition: "width 900ms var(--ease-out)",
          }}
        />
      </div>
    </div>
  )
}
