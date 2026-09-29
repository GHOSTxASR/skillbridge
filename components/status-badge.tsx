import { cn } from "@/lib/utils"

export type BadgeTone =
  | "success"
  | "warning"
  | "neutral"
  | "primary"
  | "danger"
  | "ai"

const toneStyles: Record<BadgeTone, string> = {
  success: "bg-success-muted text-success ring-success/20",
  warning: "bg-warning-muted text-warning ring-warning/20",
  neutral: "bg-surface-2 text-muted-foreground ring-border",
  primary: "bg-accent text-accent-foreground ring-primary/20",
  danger: "bg-destructive-muted text-destructive ring-destructive/20",
  ai: "bg-ai-muted text-ai ring-ai/20",
}

export function StatusBadge({
  children,
  tone = "neutral",
  className,
  icon,
}: {
  children: React.ReactNode
  tone?: BadgeTone
  className?: string
  icon?: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset [&_svg]:size-3.5",
        toneStyles[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
