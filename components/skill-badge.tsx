import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { LEVEL_META, levelFromStatus, type SkillLevel } from "@/lib/skill-status"

// A skill chip. `status` accepts either vocabulary (strength/weak/missing or
// mastered/in-progress/gap) and shows it on the shared three-level scale.
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
  status?: SkillLevel | "mastered" | "in-progress" | "gap" | "strength" | "weak"
  onRemove?: () => void
  selectable?: boolean
  selected?: boolean
  onClick?: () => void
  className?: string
}) {
  if (selectable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          "pressable inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium",
          selected
            ? "border-primary/60 bg-primary/15 text-foreground shadow-[0_0_0_3px_oklch(0.72_0.135_250/12%)]"
            : "border-border-strong bg-transparent text-muted-foreground hover:border-[oklch(1_0_0/22%)] hover:text-foreground",
          className,
        )}
      >
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded-full border transition-colors",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-border-strong"
          )}
        >
          {selected && <Check className="size-3" strokeWidth={3} />}
        </span>
        {name}
      </button>
    )
  }

  const level =
    status === "strong" || status === "developing" || status === "missing"
      ? status
      : levelFromStatus(status)

  if (level) {
    const meta = LEVEL_META[level]

    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-foreground ring-1 ring-inset ring-border",
          className,
        )}
      >
        <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden="true" />
        {name}
        <span className="sr-only">({meta.label})</span>
      </span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-secondary-foreground ring-1 ring-inset ring-border",
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
