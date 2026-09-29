"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Dialog } from "@base-ui/react/dialog"
import { Menu, X } from "lucide-react"
import { AuthGuard } from "@/components/auth/auth-guard"
import { AIAssistant, AssistantTrigger } from "@/components/ai/ai-assistant"
import { Ambient } from "@/components/brand/ambient"
import { Logo } from "@/components/brand/logo"
import { MainNav, UserChip } from "@/components/shell/nav"
import { currentNavItem } from "@/lib/journey"

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
    >
      Skip to content
    </a>
  )
}

// Phones and tablets: a translucent top bar; the navigation opens as a sheet from the
// left and closes back to the left.
function MobileBar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const current = currentNavItem(pathname)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <div className="surface-glass sticky top-0 z-30 flex h-14 items-center gap-2 border-x-0 border-t-0 px-3 lg:hidden">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger
          aria-label="Open navigation"
          className="pressable flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        >
          <Menu className="size-5" />
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup className="fixed inset-y-0 left-0 z-50 flex w-[min(320px,86vw)] flex-col border-r border-sidebar-border bg-sidebar outline-none transition-transform duration-300 ease-[var(--ease-out)] data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full">
            <div className="flex h-14 items-center justify-between px-4">
              <Dialog.Title className="sr-only">Navigation</Dialog.Title>
              <Logo />
              <Dialog.Close
                aria-label="Close navigation"
                className="pressable flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <X className="size-5" />
              </Dialog.Close>
            </div>
            <MainNav onNavigate={() => setOpen(false)} />
            <UserChip />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Link href="/" aria-label="SkillBridge home" className="flex items-center">
        <Logo compact />
      </Link>
      <span className="ml-1 truncate text-sm font-medium text-foreground">
        {current?.label ?? ""}
      </span>

      {/* The assistant page is the chat itself, so no panel trigger there. */}
      {pathname !== "/ai" && (
        <div className="ml-auto">
          <AssistantTrigger compact />
        </div>
      )}
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === "/login") {
    return <>{children}</>
  }

  // Onboarding is a focused, full-screen flow without navigation. It needs a session, not
  // a profile: this is where the profile is created.
  if (pathname === "/setup-profile") {
    return (
      <>
        <SkipLink />
        <main id="main">
          <AuthGuard requireProfile={false}>{children}</AuthGuard>
        </main>
        <AIAssistant floating="none" />
      </>
    )
  }

  return (
    <>
      <SkipLink />

      <div className="relative isolate min-h-screen">
        <Ambient variant="app" className="fixed" />

        <aside className="surface-glass fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-y-0 border-l-0 lg:flex">
          <div className="flex h-[72px] items-center px-5">
            <Link href="/" aria-label="SkillBridge home">
              <Logo />
            </Link>
          </div>
          <MainNav />
          <UserChip />
        </aside>

        <MobileBar />

        <div className="lg:pl-[264px]">
          <main
            id="main"
            className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-8 sm:px-6 lg:px-12 lg:pt-14"
          >
            {/* Pages render only for a signed-in user with a profile. */}
            <AuthGuard>{children}</AuthGuard>
          </main>
        </div>
      </div>

      {pathname !== "/ai" && <AIAssistant />}
    </>
  )
}
