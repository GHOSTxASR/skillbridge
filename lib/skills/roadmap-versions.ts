import "server-only"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// Trusted learning-roadmap versions: the immutable copy of each AI-generated roadmap that
// roadmap learning evidence is built from (public.learning_roadmap_versions). The display
// cache, public.learning_roadmaps, is written with the user's own session and is never
// trusted as evidence.
//
// This is the ONLY module that reads SUPABASE_SECRET_KEY, and app/api/learning/route.ts is
// its only importer. The privileged client never leaves this file; the only thing it does
// is call create_learning_roadmap_version(), which the database lets service_role run and
// nobody else. Failures are logged as a short code only: never the key, the request or the
// raw error. When the key is not configured nothing is recorded and roadmap evidence stays
// unavailable, while the roadmap itself keeps working.

export type RoadmapVersionStep = {
  order: number
  phase: string | null
  skill: string
  // The catalog skill the server resolved for this step; null when it had no match.
  skillId: string | null
  reason: string | null
}

export type RoadmapVersionInput = {
  userId: string
  inputHash: string
  model: string
  promptVersion: string
  generatedAt: string
  steps: RoadmapVersionStep[]
}

let privileged: SupabaseClient | null = null

function privilegedClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return null
  privileged ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return privileged
}

const safeCode = (code: unknown) => (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "unknown")

// Records one trusted version and returns its id, or null when it could not be recorded.
// Never throws.
export async function recordRoadmapVersion(input: RoadmapVersionInput): Promise<string | null> {
  const client = privilegedClient()
  if (!client) {
    console.warn("Roadmap version not recorded: the server key is not configured")
    return null
  }
  try {
    const { data, error } = await client.rpc("create_learning_roadmap_version", {
      p_user_id: input.userId,
      p_input_hash: input.inputHash,
      p_model: input.model,
      p_prompt_version: input.promptVersion,
      p_generated_at: input.generatedAt,
      p_steps: input.steps,
    })
    if (error) {
      console.error("Roadmap version not recorded:", safeCode(error.code))
      return null
    }
    return typeof data === "string" ? data : null
  } catch {
    console.error("Roadmap version not recorded: request failed")
    return null
  }
}
