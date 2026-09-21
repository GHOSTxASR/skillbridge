import { createSupabaseServerClient } from "@/lib/supabase-server"

export async function getUserProfile() {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()

  if (error) {
    console.error("Profile fetch error:", error)
    return null
  }

  return data
}
