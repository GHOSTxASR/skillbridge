"use client"

import { Bell, Search, Menu, Check, Circle } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

const initialNotifications = [
  {
    id: 1,
    title: "AI Roadmap Ready",
    message: "Your personalized learning roadmap is ready to review.",
    time: "Just now",
    unread: true,
  },
  {
    id: 2,
    title: "Skill Gap Analysis Updated",
    message: "Your AI analysis has identified priority skills for your target role.",
    time: "5 min ago",
    unread: true,
  },
  {
    id: 3,
    title: "New Learning Resources",
    message: "New GitHub, YouTube and official documentation resources are available.",
    time: "1 hour ago",
    unread: false,
  },
]

export function Navbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(initialNotifications)

  const unreadCount = notifications.filter(
    (notification) => notification.unread
  ).length

  const markAllAsRead = () => {
    setNotifications((current) =>
      current.map((notification) => ({
        ...notification,
        unread: false,
      }))
    )
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-card px-4 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onMenuClick}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>

      <div className="relative hidden max-w-sm flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder="Search skills, jobs, courses..."
          className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
        />
      </div>

      <div className="relative ml-auto flex items-center gap-2 md:gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          className="relative"
          onClick={() => setOpen((current) => !current)}
        >
          <Bell className="size-5" />

          {unreadCount > 0 && (
  <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-warning ring-2 ring-card" />
)}
        </Button>

        {open && (
          <div className="absolute right-0 top-12 z-50 w-[360px] overflow-hidden rounded-lg border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Notifications
                </h3>
                <p className="text-xs text-muted-foreground">
                  {unreadCount > 0
                    ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}`
                    : "You're all caught up"}
                </p>
              </div>

              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Check className="size-3.5" />
                  Mark all as read
                </button>
              )}
            </div>

            <div className="max-h-[380px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No notifications
                  </p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => {
                      setNotifications((current) =>
                        current.map((item) =>
                          item.id === notification.id
                            ? { ...item, unread: false }
                            : item
                        )
                      )
                    }}
                    className="flex w-full gap-3 border-b border-border px-4 py-4 text-left transition-colors hover:bg-accent"
                  >
                    <div className="pt-1">
                      {notification.unread ? (
                        <Circle className="size-2.5 fill-primary text-primary" />
                      ) : (
                        <Circle className="size-2.5 text-muted-foreground/30" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">
                          {notification.title}
                        </p>

                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {notification.time}
                        </span>
                      </div>

                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {notification.message}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}

