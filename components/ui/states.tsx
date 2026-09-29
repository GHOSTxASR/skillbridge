import {
  AlertTriangle,
  Info,
  RefreshCw,
  Sparkles,
  CircleCheck,
  CircleAlert,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

// Every loading, empty, error and notice state in the app comes from here, so they
// read as part of the product rather than as browser messages.

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton h-4", className)} />
}

// A contextual loader: says what is happening, never shows a fake percentage.
export function LoadingState({
  title,
  description,
  icon: Icon = Sparkles,
  children,
  className,
}: {
  title: string
  description?: string
  icon?: React.ElementType
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("py-6", className)} role="status" aria-live="polite">
      <div className="flex items-center gap-4">
        <span className="relative flex size-11 items-center justify-center">
          <span
            className="absolute inset-0 rounded-full border border-ai/30"
            style={{ animation: "sb-pulse-soft 2.4s ease-in-out infinite" }}
          />
          <span className="absolute inset-1.5 rounded-full bg-ai-muted" />
          <Icon className="relative size-5 text-ai" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {children && <div className="mt-10">{children}</div>}
    </div>
  )
}

export function EmptyState({
  icon: Icon = Info,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ElementType
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-4 rounded-2xl border border-dashed border-border-strong px-6 py-10 sm:items-center sm:text-center",
        className
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="max-w-md">
        <p className="type-heading text-foreground">{title}</p>
        {description && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1 flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Try again",
  action,
  className,
}: {
  title?: string
  description?: React.ReactNode
  onRetry?: () => void
  retryLabel?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-4 rounded-2xl border border-destructive/20 bg-destructive-muted/40 px-6 py-8",
        className
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-destructive-muted text-destructive">
        <AlertTriangle className="size-5" />
      </span>
      <div className="max-w-lg">
        <p className="type-heading text-foreground">{title}</p>
        {description && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      {(onRetry || action) && (
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RefreshCw />
              {retryLabel}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  )
}

type NoticeTone = "info" | "ai" | "warning" | "danger" | "success"

const noticeTone: Record<NoticeTone, { box: string; icon: React.ElementType; iconClass: string }> = {
  info: { box: "border-border-strong bg-surface-2/60", icon: Info, iconClass: "text-primary" },
  ai: { box: "border-ai/20 bg-ai-muted", icon: Sparkles, iconClass: "text-ai" },
  warning: { box: "border-warning/25 bg-warning-muted", icon: CircleAlert, iconClass: "text-warning" },
  danger: { box: "border-destructive/25 bg-destructive-muted", icon: AlertTriangle, iconClass: "text-destructive" },
  success: { box: "border-success/25 bg-success-muted", icon: CircleCheck, iconClass: "text-success" },
}

// Inline status: explains the state of what is shown (cached, estimate, limit...).
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: NoticeTone
  title?: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const config = noticeTone[tone]
  const Icon = config.icon

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        config.box,
        className
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", config.iconClass)} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-foreground">{title}</p>}
        {children && (
          <div className={cn("leading-relaxed text-muted-foreground", title && "mt-0.5")}>
            {children}
          </div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
