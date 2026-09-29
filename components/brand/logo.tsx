import { useId } from "react"
import { cn } from "@/lib/utils"

// The SkillBridge mark: an arc bridging two nodes, where you are (azure) and where
// you are going (cyan), over a deck with hangers.
export function LogoMark({ className }: { className?: string }) {
  const id = useId()

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-8", className)}
    >
      <defs>
        <linearGradient id={`${id}-arc`} x1="4" y1="22" x2="28" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--primary)" />
          <stop offset="1" stopColor="var(--ai)" />
        </linearGradient>
      </defs>
      <path
        d="M11 17.4V22.5M16 15.6V22.5M21 17.4V22.5"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M3.5 22.5H28.5" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M5 22.5C8.4 11.8 23.6 11.8 27 22.5"
        stroke={`url(#${id}-arc)`}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="5" cy="22.5" r="2.4" fill="var(--primary)" />
      <circle cx="27" cy="22.5" r="2.4" fill="var(--ai)" />
    </svg>
  )
}

export function Logo({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="size-8 text-foreground" />
      {!compact && (
        <span className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-foreground">
          SkillBridge
        </span>
      )}
    </span>
  )
}
