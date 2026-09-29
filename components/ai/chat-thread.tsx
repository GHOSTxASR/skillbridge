"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, CircleAlert, Sparkles, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { useShellProfile } from "@/lib/profile-store"
import { sendChatMessage, useChat, type ChatMessage } from "@/components/ai/chat-store"
import { MarkdownLite } from "@/components/ai/markdown-lite"

// Same limit as /api/ai (MAX_MESSAGE_LENGTH).
const MAX_MESSAGE_LENGTH = 4000

function ContextLine() {
  const { status, profile } = useShellProfile()

  if (status === "loading" || status === "idle") {
    return <span className="skeleton inline-block h-3.5 w-48" />
  }

  if (!profile?.targetRole) {
    return <span>Finish your profile so answers can use your target role.</span>
  }

  const parts = [
    profile.targetRole,
    profile.experience || null,
    profile.skills.length ? `${profile.skills.length} skill${profile.skills.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean)

  return (
    <span>
      Using your profile: <span className="text-muted-foreground">{parts.join(" · ")}</span>
    </span>
  )
}

function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  const { profile } = useShellProfile()
  const role = profile?.targetRole || "my target role"

  const prompts = [
    `What should I learn first to become a ${role}?`,
    `Suggest a portfolio project for a ${role}.`,
    `How should I prepare for ${role} interviews?`,
    `Which of my current skills matter most for ${role}?`,
  ]

  return (
    <div className="grid gap-2">
      {prompts.map((prompt, index) => (
        <button
          key={prompt}
          type="button"
          onClick={() => onPick(prompt)}
          className="pressable reveal rounded-xl border border-border bg-surface-2/50 px-4 py-3 text-left text-sm text-muted-foreground hover:border-border-strong hover:bg-surface-2 hover:text-foreground"
          style={{ "--i": index + 1 } as React.CSSProperties}
        >
          {prompt}
        </button>
      ))}
    </div>
  )
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary/15 px-4 py-2.5 text-sm leading-relaxed text-foreground ring-1 ring-inset ring-primary/20">
          {message.text}
        </div>
      </div>
    )
  }

  const problem = message.kind === "error" || message.kind === "limit"

  return (
    <div className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
          problem ? "bg-warning-muted text-warning" : "bg-ai-muted text-ai"
        )}
        aria-hidden="true"
      >
        {problem ? <CircleAlert className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        {message.kind === "fallback" && (
          <p className="type-eyebrow mb-1.5 text-warning">AI unavailable · basic answer</p>
        )}
        <div className="text-sm leading-relaxed text-foreground/90">
          <MarkdownLite text={message.text} />
        </div>
      </div>
    </div>
  )
}

export function ChatThread({
  variant = "panel",
  autoFocus = false,
}: {
  variant?: "panel" | "page"
  autoFocus?: boolean
}) {
  const { messages, loading } = useChat()
  const [draft, setDraft] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [messages.length, loading])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Grow the composer with its content, up to about six lines.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  const send = (text: string) => {
    if (!text.trim() || loading) return
    setDraft("")
    void sendChatMessage(text)
  }

  const empty = messages.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          variant === "page" ? "px-1 py-2" : "px-5 py-5"
        )}
        aria-live="polite"
      >
        {empty ? (
          <div className="flex h-full flex-col justify-end gap-6 pb-2">
            <div className="reveal">
              <span className="flex size-10 items-center justify-center rounded-xl bg-ai-muted text-ai">
                <Sparkles className="size-5" />
              </span>
              <p className="type-heading mt-4 text-foreground">
                Ask about your career path
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Skills, learning order, projects and interview preparation, answered
                for your target role.
              </p>
            </div>
            <Suggestions onPick={send} />
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            {loading && (
              <div className="flex items-center gap-3" role="status">
                <span className="flex size-7 items-center justify-center rounded-full bg-ai-muted text-ai" aria-hidden="true">
                  <Sparkles className="size-3.5" />
                </span>
                <span className="flex items-center gap-1" aria-label="Thinking">
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="typing-dot size-1.5 rounded-full bg-ai"
                      style={{ animationDelay: `${dot * 160}ms` }}
                    />
                  ))}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={cn(variant === "page" ? "pt-4" : "border-t border-border px-4 pb-4 pt-3")}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            send(draft)
          }}
          className="flex items-end gap-2 rounded-2xl border border-border-strong bg-[oklch(0.13_0.01_262/60%)] p-1.5 pl-4 transition-[border-color,box-shadow] focus-within:border-primary/60 focus-within:shadow-[0_0_0_4px_oklch(0.72_0.135_250/12%)]"
        >
          <label htmlFor={`chat-input-${variant}`} className="sr-only">
            Message SkillBridge assistant
          </label>
          <textarea
            id={`chat-input-${variant}`}
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                send(draft)
              }
            }}
            placeholder="Ask SkillBridge…"
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-subtle-foreground focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            aria-label="Send message"
            className="pressable flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:bg-surface-2 disabled:text-subtle-foreground"
          >
            <ArrowUp className="size-4" strokeWidth={2.5} />
          </button>
        </form>
        <p className="mt-2 flex items-start gap-1.5 px-1 text-[11px] leading-4 text-subtle-foreground">
          <UserRound className="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>
            <ContextLine /> Each question is answered on its own.
          </span>
        </p>
      </div>
    </div>
  )
}
