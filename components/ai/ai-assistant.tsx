"use client"

import Link from "next/link"
import { Dialog } from "@base-ui/react/dialog"
import { Maximize2, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ChatThread } from "@/components/ai/chat-thread"
import { setAssistantOpen, useChat } from "@/components/ai/chat-store"

// Opens the assistant panel. `compact` is the icon-only form used in the mobile bar.
export function AssistantTrigger({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setAssistantOpen(true)}
        aria-label="Open SkillBridge assistant"
        className="pressable flex size-10 items-center justify-center rounded-lg text-ai hover:bg-ai-muted"
      >
        <Sparkles className="size-5" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setAssistantOpen(true)}
      className="pressable group flex h-12 items-center gap-2.5 rounded-full border border-ai/25 bg-[oklch(0.19_0.02_220/85%)] pl-3.5 pr-5 text-sm font-medium text-foreground shadow-[0_12px_40px_-12px_oklch(0.82_0.11_192/35%)] backdrop-blur-xl hover:border-ai/40"
    >
      <span className="flex size-7 items-center justify-center rounded-full bg-ai-muted text-ai transition-transform duration-300 group-hover:rotate-12">
        <Sparkles className="size-4" />
      </span>
      Ask SkillBridge
    </button>
  )
}

// A docked, non-blocking panel: it slides in from the right edge, leaves the page
// usable, and closes back to the right (Escape or the close button).
// `floating`: where the floating "Ask SkillBridge" button shows. Screens that place a
// trigger themselves (the mobile bar, the onboarding header) use "desktop" or "none".
export function AIAssistant({
  floating = "desktop",
}: {
  floating?: "desktop" | "none"
}) {
  const { open } = useChat()

  return (
    <>
      {!open && floating !== "none" && (
        <div className={cn("fixed bottom-6 right-6 z-40 hidden lg:flex reveal")}>
          <AssistantTrigger />
        </div>
      )}

      <Dialog.Root
        open={open}
        onOpenChange={setAssistantOpen}
        modal={false}
        disablePointerDismissal
      >
        <Dialog.Portal>
          <Dialog.Popup
            initialFocus={false}
            className="surface-glass fixed inset-0 z-50 flex flex-col outline-none transition-[transform,opacity] duration-300 ease-[var(--ease-out)] data-[ending-style]:translate-x-6 data-[ending-style]:opacity-0 data-[starting-style]:translate-x-6 data-[starting-style]:opacity-0 sm:inset-y-3 sm:left-auto sm:right-3 sm:w-[420px] sm:rounded-2xl sm:shadow-[0_30px_80px_-20px_rgb(0_0_0/70%)]"
          >
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <span className="flex size-9 items-center justify-center rounded-xl bg-ai-muted text-ai">
                <Sparkles className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-sm font-semibold text-foreground">
                  SkillBridge Assistant
                </Dialog.Title>
                <Dialog.Description className="text-xs text-subtle-foreground">
                  Career guidance for your target role
                </Dialog.Description>
              </div>
              <Link
                href="/ai"
                onClick={() => setAssistantOpen(false)}
                aria-label="Open full-page assistant"
                title="Open full page"
                className="pressable flex size-9 items-center justify-center rounded-lg text-subtle-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <Maximize2 className="size-4" />
              </Link>
              <Dialog.Close
                aria-label="Close assistant"
                className="pressable flex size-9 items-center justify-center rounded-lg text-subtle-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <X className="size-4.5" />
              </Dialog.Close>
            </div>
            <ChatThread variant="panel" autoFocus={open} />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
