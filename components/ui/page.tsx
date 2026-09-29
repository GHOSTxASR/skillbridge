import { cn } from "@/lib/utils"

// Page-level structure. Hierarchy comes from type, spacing and dividers; surfaces
// (cards) are reserved for things that are genuinely grouped.

export function Eyebrow({
  children,
  tone = "muted",
  className,
}: {
  children: React.ReactNode
  tone?: "muted" | "primary" | "ai"
  className?: string
}) {
  return (
    <p
      className={cn(
        "type-eyebrow inline-flex items-center gap-2",
        tone === "muted" && "text-subtle-foreground",
        tone === "primary" && "text-primary",
        tone === "ai" && "text-ai",
        className
      )}
    >
      {children}
    </p>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  meta?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        "mb-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between",
        className
      )}
    >
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="mb-3">{eyebrow}</div>}
        <h1 className="type-title text-foreground">{title}</h1>
        {description && (
          <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        )}
        {meta && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-subtle-foreground">
            {meta}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  )
}

export function Section({
  title,
  description,
  action,
  children,
  className,
  divider = false,
  id,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  divider?: boolean
  id?: string
}) {
  return (
    <section
      id={id}
      className={cn(divider && "border-t border-border pt-10", className)}
    >
      {(title || action) && (
        <div className="mb-5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            {title && <h2 className="type-heading text-foreground">{title}</h2>}
            {description && (
              <p className="mt-1 text-sm text-muted-foreground text-pretty">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

// A quiet label/value pair for inline facts ("Target role · Full Stack Developer").
export function Fact({
  label,
  children,
  className,
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="type-eyebrow text-subtle-foreground">{label}</p>
      <div className="mt-1.5 truncate text-sm font-medium text-foreground">
        {children}
      </div>
    </div>
  )
}
