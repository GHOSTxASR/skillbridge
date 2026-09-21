import { cn } from "@/lib/utils"

type Tone = "primary" | "success" | "warning"

const toneStyles: Record<Tone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
}

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

  return (
    <div className={cn("w-full", className)}>
      {(showLabel || label) && (
        <div className="mb-1.5 flex items-center justify-between text-xs">
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
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          "w-full overflow-hidden rounded-full bg-secondary",
          size === "sm" ? "h-1.5" : "h-2.5",
        )}
      >
        <div
          className={cn("h-full rounded-full transition-all", toneStyles[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
