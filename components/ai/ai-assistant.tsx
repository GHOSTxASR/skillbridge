"use client"

import { supabase } from "@/lib/supabase-browser"

import { useEffect, useState } from "react"

type Message = {
  role: "user" | "ai"
  text: string
}

type Profile = {
  name?: string
  email?: string
  education?: string
  institution?: string
  skills?: string
  career?: string
}

export function AIAssistant() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

  const [profile, setProfile] = useState<Profile>({})

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "ai",
      text: "Hi! I am your SkillBridge Help Assistant. How can I help you today?",
    },
  ])

  useEffect(() => {
    async function loadProfile() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) return

        const saved = localStorage.getItem(`skillbridge-profile-${user.id}`)

        if (saved) {
          setProfile(JSON.parse(saved))
        }
      } catch {
        console.log("Could not load profile")
      }
    }

    loadProfile()
  }, [])

  const sendMessage = async () => {
    const text = message.trim()

    if (!text || loading) return

    setMessage("")

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text,
      },
    ])

    setLoading(true)

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          profile,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "AI request failed")
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: data.reply,
        },
      ])
    } catch (error) {
      console.error(error)

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: "Sorry, I could not connect to the AI right now. Please try again.",
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full border bg-card text-primary shadow-lg transition hover:scale-105"
          aria-label="Open Help"
        >
          <svg
            viewBox="0 0 64 64"
            className="h-8 w-8"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="10"
              y="16"
              width="44"
              height="36"
              rx="14"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              d="M32 16V9"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx="32" cy="7" r="3" fill="currentColor" />
            <circle cx="24" cy="32" r="4" fill="currentColor" />
            <circle cx="40" cy="32" r="4" fill="currentColor" />
            <path
              d="M23 42C28 46 36 46 41 42"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="M10 31H5M59 31H54"
              stroke="currentColor"
              strokeWidth="3"
            />
          </svg>
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[520px] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
            <div>
              <h2 className="font-semibold">Help</h2>
              <p className="text-xs opacity-80">
                SkillBridge Assistant
              </p>
            </div>

            <button
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-1 text-lg hover:bg-primary-foreground/10"
              aria-label="Close Help"
            >
              X
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((item, index) => (
              <div
                key={index}
                className={`flex ${
                  item.role === "user"
                    ? "justify-end"
                    : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    item.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {item.text}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-muted px-3 py-2 text-sm">
                  Thinking...
                </div>
              </div>
            )}
          </div>

          <div className="border-t p-3">
            <div className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    sendMessage()
                  }
                }}
                placeholder="Ask for help..."
                disabled={loading}
                className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
              />

              <button
                onClick={sendMessage}
                disabled={loading}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}





