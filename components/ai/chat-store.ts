"use client"

import { useSyncExternalStore } from "react"

// One conversation shared by the docked assistant panel and the full /ai page, kept
// in memory for the session. Sending works exactly as before: POST /api/ai with the
// message; the server answers from the signed-in user's saved profile. Each message is
// answered on its own (the API receives only the latest message).

export type ChatMessage = {
  id: number
  role: "user" | "ai"
  text: string
  // How an assistant message came about, so the UI can label it honestly.
  kind?: "answer" | "fallback" | "limit" | "error"
}

type ChatState = {
  messages: ChatMessage[]
  loading: boolean
  open: boolean
}

let state: ChatState = { messages: [], loading: false, open: false }
let nextId = 1
const listeners = new Set<() => void>()

function setState(patch: Partial<ChatState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function push(message: Omit<ChatMessage, "id">) {
  setState({ messages: [...state.messages, { ...message, id: nextId++ }] })
}

export function setAssistantOpen(open: boolean) {
  setState({ open })
}

export async function sendChatMessage(input: string) {
  const text = input.trim()

  if (!text || state.loading) return

  push({ role: "user", text })
  setState({ loading: true })

  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: text }),
    })

    const data = await response.json()

    // Over the per-user AI limit: say so, instead of a connection error.
    if (response.status === 429) {
      push({
        role: "ai",
        kind: "limit",
        text:
          typeof data?.message === "string"
            ? data.message
            : "You've reached the AI request limit. Please try again later.",
      })
      return
    }

    if (!response.ok) {
      throw new Error(data?.error || "AI request failed")
    }

    push({
      role: "ai",
      kind: data?.ai === false ? "fallback" : "answer",
      text:
        typeof data?.reply === "string"
          ? data.reply
          : "I couldn't generate a response right now.",
    })
  } catch (error) {
    console.error("SkillBridge assistant error:", error)

    push({
      role: "ai",
      kind: "error",
      text: "Sorry, I couldn't connect to the AI service right now. Please try again.",
    })
  } finally {
    setState({ loading: false })
  }
}

export function useChat() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  )
}
