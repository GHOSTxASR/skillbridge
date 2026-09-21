"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Home,
  ClipboardCheck,
  Search,
  Map,
  BriefcaseBusiness,
  BarChart3,
  User,
  LogOut,
  ShieldCheck,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase-browser"

const items = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/assessment", label: "Skill Assessment", icon: ClipboardCheck },
  { href: "/gap-analysis", label: "Skill Gap Analysis", icon: Search },
  { href: "/roadmap", label: "Learning Roadmap", icon: Map },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/readiness", label: "Job Readiness", icon: BarChart3 },
  { href: "/account", label: "Account Information", icon: User },
]

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function logout() {
    await supabase.auth.signOut()
    router.replace("/login")
    router.refresh()
  }

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">

      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b px-5">
        <div className="flex size-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <ShieldCheck className="size-5" />
        </div>

        <div>
          <div className="text-sm font-semibold">
            SkillBridge
          </div>

          <div className="text-[11px] opacity-60">
            
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">

        {items.map((item) => {
          const Icon = item.icon

          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "opacity-80 hover:bg-sidebar-accent/60 hover:opacity-100"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          )
        })}

      </nav>

      {/* Logout */}
      <div className="border-t p-4">
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium opacity-80 transition-colors hover:bg-sidebar-accent/60 hover:opacity-100"
        >
          <LogOut className="size-4 shrink-0" />
          Logout
        </button>
      </div>

    </aside>
  )
}

