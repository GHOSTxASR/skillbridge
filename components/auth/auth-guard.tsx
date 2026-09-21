"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase-browser"

export function AuthGuard() {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    let mounted = true

    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!mounted) return

      if (!session && pathname !== "/login") {
        router.replace("/login")
        return
      }

      if (session && pathname === "/login") {
        router.replace("/")
      }
    }

    checkAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && pathname !== "/login") {
        router.replace("/login")
      }

      if (session && pathname === "/login") {
        router.replace("/")
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [pathname, router])

  return null
}
