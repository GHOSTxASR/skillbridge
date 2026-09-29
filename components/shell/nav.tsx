"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase-browser"
import { ASSISTANT, JOURNEY, OVERVIEW, SKILLS, isActive, type NavItem } from "@/lib/journey"
import { resetShellProfile, useShellProfile } from "@/lib/profile-store"

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "pressable group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-subtle-foreground group-hover:text-muted-foreground")} />
      {item.label}
    </Link>
  )
}

// The journey is drawn as a connected rail: each stage is a node on one line, so the
// pages read as steps of one process rather than unrelated tools.
function JourneyRail({
  pathname,
  onNavigate,
}: {
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <ol className="relative">
      <span
        aria-hidden="true"
        className="absolute bottom-5 left-[27px] top-5 w-px bg-[linear-gradient(to_bottom,oklch(1_0_0/10%),oklch(1_0_0/5%))]"
      />
      {JOURNEY.map((item) => {
        const active = isActive(pathname, item.href)
        const Icon = item.icon

        return (
          <li key={item.href} className="relative">
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "pressable group flex items-center gap-3 rounded-lg px-3 py-2",
                active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
              )}
            >
              <span
                className={cn(
                  "relative z-10 flex size-[30px] shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors",
                  active
                    ? "border-primary/60 bg-[oklch(0.25_0.05_250)] text-primary shadow-[0_0_0_4px_oklch(0.72_0.135_250/10%)]"
                    : "border-border-strong bg-sidebar text-subtle-foreground group-hover:text-muted-foreground"
                )}
              >
                {item.step === 0 ? <Icon className="size-3.5" /> : item.step}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block truncate text-sm font-medium",
                    active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                  )}
                >
                  {item.label}
                </span>
                <span className="block text-[11px] leading-4 text-subtle-foreground">
                  {item.stage}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}

export function UserChip() {
  const router = useRouter()
  const { profile } = useShellProfile()

  const name = profile?.name || "Your account"
  const initial = (profile?.name || profile?.email || "U").charAt(0).toUpperCase()

  async function logout() {
    await supabase.auth.signOut()
    resetShellProfile()
    router.replace("/login")
    router.refresh()
  }

  return (
    <div className="flex items-center gap-3 border-t border-sidebar-border px-4 py-4">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full p-px"
        style={{ background: "var(--brand-gradient)" }}
        aria-hidden="true"
      >
        <span className="flex size-full items-center justify-center rounded-full bg-sidebar text-sm font-semibold text-foreground">
          {initial}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p className="truncate text-xs text-subtle-foreground">
          {profile?.targetRole || "Career goal not set"}
        </p>
      </div>
      <button
        type="button"
        onClick={logout}
        aria-label="Sign out"
        title="Sign out"
        className="pressable flex size-9 items-center justify-center rounded-lg text-subtle-foreground hover:bg-sidebar-accent hover:text-foreground"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  )
}

export function MainNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-6">
      <NavLink item={OVERVIEW} active={isActive(pathname, OVERVIEW.href)} onNavigate={onNavigate} />
      <div className="mt-1">
        <NavLink item={SKILLS} active={isActive(pathname, SKILLS.href)} onNavigate={onNavigate} />
      </div>

      <p className="type-eyebrow mb-2 mt-7 px-3 text-subtle-foreground">Your journey</p>
      <JourneyRail pathname={pathname} onNavigate={onNavigate} />

      <p className="type-eyebrow mb-2 mt-7 px-3 text-subtle-foreground">Tools</p>
      <NavLink item={ASSISTANT} active={isActive(pathname, ASSISTANT.href)} onNavigate={onNavigate} />
    </nav>
  )
}
