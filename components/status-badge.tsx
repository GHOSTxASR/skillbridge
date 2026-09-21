import { cn } from "@/lib/utils"

export type BadgeTone =
  | "success"
  | "warning"
  | "neutral"
  | "primary"
  | "danger"

const toneStyles: Record<BadgeTone, string> = {
  success: "bg-success-muted text-success border-success/20",
  warning: "bg-warning-muted text-warning border-warning/25",
  neutral: "bg-secondary text-secondary-foreground border-border",
  primary: "bg-accent text-accent-foreground border-primary/15",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
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
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneStyles[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
