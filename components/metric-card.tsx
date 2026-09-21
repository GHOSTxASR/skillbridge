import { TrendingUp, TrendingDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/card"

type Tone = "primary" | "success" | "warning" | "neutral"

const iconToneStyles: Record<Tone, string> = {
  primary: "bg-accent text-primary",
  success: "bg-success-muted text-success",
  warning: "bg-warning-muted text-warning",
  neutral: "bg-secondary text-muted-foreground",
}

export function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  tone = "neutral",
  trend,
  hint,
}: {
  label: string
  value: string | number
  unit?: string
  icon?: React.ElementType
  tone?: Tone
  trend?: { value: string; direction: "up" | "down" }
  hint?: string
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-md",
              iconToneStyles[tone],
            )}
          >
            <Icon className="size-4.5" />
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
          {value}
        </span>
        {unit && (
          <span className="text-lg font-medium text-muted-foreground">{unit}</span>
        )}
      </div>
      {(trend || hint) && (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          {trend && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-medium",
                trend.direction === "up" ? "text-success" : "text-warning",
              )}
            >
              {trend.direction === "up" ? (
                <TrendingUp className="size-3.5" />
              ) : (
                <TrendingDown className="size-3.5" />
              )}
              {trend.value}
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      )}
    </Card>
  )
}
