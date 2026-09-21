import { Check, Clock, AlertTriangle, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SkillStatus } from "@/lib/mock-data"

const statusConfig: Record<
  SkillStatus,
  { icon: typeof Check; className: string }
> = {
  mastered: {
    icon: Check,
    className: "bg-success-muted text-success border-success/25",
  },
  "in-progress": {
    icon: Clock,
    className: "bg-accent text-accent-foreground border-primary/20",
  },
  gap: {
    icon: AlertTriangle,
    className: "bg-warning-muted text-warning border-warning/30",
  },
}

export function SkillBadge({
  name,
  status,
  onRemove,
  selectable,
  selected,
  onClick,
  className,
}: {
  name: string
  status?: SkillStatus
  onRemove?: () => void
  selectable?: boolean
  selected?: boolean
  onClick?: () => void
  className?: string
}) {
  // Selectable variant (used in the assessment picker)
  if (selectable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent",
          className,
        )}
      >
        {selected && <Check className="size-3.5" />}
        {name}
      </button>
    )
  }

  // Status variant (used across dashboards / analysis)
  if (status) {
    const config = statusConfig[status]
    const Icon = config.icon
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
          config.className,
          className,
        )}
      >
        <Icon className="size-3.5" />
        {name}
      </span>
    )
  }

  // Plain tag variant, optionally removable
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground",
        className,
      )}
    >
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="rounded-full p-0.5 text-muted-foreground hover:bg-border hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}
