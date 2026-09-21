"use client"

import { useState } from "react"

type ChatMessage = {
  role: "user" | "ai"
  text: string
}

export default function AIPage() {
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "ai",
      text:
        "Hi! I'm your SkillBridge AI Career Assistant. Ask me anything about skills, careers, learning paths, jobs, or interview preparation.",
    },
  ])

  const sendMessage = async () => {
    const userMessage = message.trim()

    if (!userMessage || loading) return

    setMessage("")

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: userMessage,
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
          message: userMessage,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(
          result?.error ||
            "Unable to connect to SkillBridge AI."
        )
      }

      const reply =
        typeof result?.reply === "string"
          ? result.reply
          : "I couldn't generate a response right now."

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: reply,
        },
      ])
    } catch (error) {
      console.error(
        "SkillBridge chatbot error:",
        error
      )

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text:
            "Sorry, I couldn't connect to the AI service right now. Please try again.",
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-140px)] flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          SkillBridge AI
        </h1>

        <p className="text-sm text-muted-foreground">
          Your personal AI career and skill assistant.
        </p>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
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
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
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
              <div className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                Thinking...
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-4">
          <div className="flex gap-3">
            <input
              value={message}
              onChange={(e) =>
                setMessage(e.target.value)
              }
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey
                ) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              disabled={loading}
              placeholder="Ask SkillBridge AI..."
              className="flex-1 rounded-xl border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
            />

            <button
              onClick={sendMessage}
              disabled={
                loading || !message.trim()
              }
              className="rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
