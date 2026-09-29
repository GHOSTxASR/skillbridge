"use client"

import { Sparkles } from "lucide-react"
import { ChatThread } from "@/components/ai/chat-thread"
import { Eyebrow } from "@/components/ui/page"

// The full-page view of the same conversation the docked assistant panel shows.
export default function AIPage() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-3xl flex-col lg:h-[calc(100dvh-8.5rem)]">
      <header className="mb-6">
        <Eyebrow tone="ai">
          <Sparkles className="size-3.5" />
          Assistant
        </Eyebrow>
        <h1 className="type-title mt-3 text-foreground">SkillBridge Assistant</h1>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground">
          Career guidance, learning order, projects and interview preparation for your
          target role.
        </p>
      </header>

      <ChatThread variant="page" autoFocus />
    </div>
  )
}
