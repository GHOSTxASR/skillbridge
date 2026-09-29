import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

// Single-choice options used by onboarding and the assessment. Rendered as radios
// inside a radiogroup, with instant press feedback and a clear selected state.

const optionBase =
  "pressable reveal text-left border outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
const optionIdle =
  "border-border-strong bg-[oklch(0.17_0.012_262/70%)] hover:border-[oklch(1_0_0/22%)] hover:bg-surface-2"
const optionSelected =
  "border-primary/60 bg-primary/12 shadow-[0_0_0_4px_oklch(0.72_0.135_250/10%)]"

export function ChoiceTile({
  label,
  sublabel,
  icon: Icon,
  selected,
  onSelect,
  index = 0,
}: {
  label: string
  sublabel?: string
  icon?: React.ElementType
  selected: boolean
  onSelect: () => void
  index?: number
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(optionBase, "flex items-center gap-3 rounded-2xl px-4 py-4", selected ? optionSelected : optionIdle)}
      style={{ "--i": index } as React.CSSProperties}
    >
      {Icon && (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
            selected ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground"
          )}
        >
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {sublabel && <span className="mt-0.5 block text-xs text-primary">{sublabel}</span>}
      </span>
    </button>
  )
}

export function ChoiceRow({
  label,
  description,
  selected,
  onSelect,
  index = 0,
}: {
  label: string
  description?: string
  selected: boolean
  onSelect: () => void
  index?: number
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(optionBase, "flex w-full items-center gap-4 rounded-2xl px-5 py-4", selected ? optionSelected : optionIdle)}
      style={{ "--i": index } as React.CSSProperties}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border-strong"
        )}
      >
        {selected && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>}
      </span>
    </button>
  )
}

// A thin segmented progress indicator with step labels.
export function StepProgress({
  steps,
  current,
  className,
}: {
  steps: string[]
  current: number
  className?: string
}) {
  return (
    <ol className={cn("grid gap-2", className)} style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Progress">
      {steps.map((label, index) => (
        <li key={label} className="min-w-0">
          <div className="h-1 overflow-hidden rounded-full bg-[oklch(1_0_0/8%)]">
            <div
              className="h-full rounded-full"
              style={{
                width: index <= current ? "100%" : "0%",
                background: "var(--brand-gradient)",
                transition: "width 520ms var(--ease-out)",
              }}
            />
          </div>
          <p
            className={cn("mt-2 hidden truncate text-xs sm:block", index === current ? "text-foreground" : "text-subtle-foreground")}
            aria-current={index === current ? "step" : undefined}
          >
            {label}
          </p>
        </li>
      ))}
    </ol>
  )
}
