"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { AuthGuard } from "@/components/auth/auth-guard"
import { Navbar } from "@/components/navbar"
import { AIAssistant } from "@/components/ai/ai-assistant"

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  if (pathname === "/login") {
    return <>{children}</>
  }

  return (
    <>
      <AuthGuard />
      <div className="flex min-h-screen bg-background">
        <div className="hidden md:block">
          <AppSidebar />
        </div>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-foreground/40"
              onClick={() => setMobileOpen(false)}
            />
            <div className="absolute left-0 top-0 h-full">
              <AppSidebar />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <Navbar onMenuClick={() => setMobileOpen(true)} />
          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
            <div className="mx-auto w-full max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>

      <AIAssistant />
    </>
  )
}
