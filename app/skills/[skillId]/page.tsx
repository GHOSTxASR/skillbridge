"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, LogIn, SearchX } from "lucide-react"

import { useShellProfile } from "@/lib/profile-store"
import { supabase } from "@/lib/supabase-browser"
import { failureText, getJson, type Load } from "@/lib/skills/load"
import { readEvidenceResponse, STATUS_LABEL, type EvidenceResponse } from "@/lib/skills/view"
import {
  buildEvidenceEntries,
  buildSkillDetail,
  isSkillId,
  readCatalogSkill,
  readSkillDetailResponse,
  skillHeading,
  type CatalogLoad,
  type SkillDetailResponse,
} from "@/lib/skills/detail"
import { buttonVariants } from "@/components/ui/button"
import { Eyebrow, PageHeader } from "@/components/ui/page"
import { EmptyState, ErrorState, Notice } from "@/components/ui/states"
import { StatusBadge } from "@/components/status-badge"
import { SkillStatusPanel, type Part } from "@/components/skills/skill-status-panel"
import { SkillEvidence } from "@/components/skills/skill-evidence"
import { SkillClaim, SkillProgress, SkillRecordSkeleton } from "@/components/skills/skill-record"
import { SkillNextSteps } from "@/components/skills/skill-next-steps"

// One canonical skill, for the signed-in user. Read-only, three independent reads, each
// retried on its own:
//   - the skill's catalog record (public.skills, public read) -> name and category;
//   - GET /api/skills/progress?skillId= -> the user's progress and claims for it;
//   - GET /api/skills/evidence?skillId= -> the user's evidence for it.
// The id selects the skill; whose rows these are is decided by the session on the server.

// One catalog row by id, through the existing public read policy on public.skills.
async function loadCatalogSkill(skillId: string, signal: AbortSignal): Promise<CatalogLoad> {
  try {
    const { data, error } = await supabase
      .from("skills")
      .select("id, name, category")
      .eq("id", skillId)
      .abortSignal(signal)
      .maybeSingle()
    if (signal.aborted) throw new Error("aborted")
    return error ? { state: "error" } : { state: "ready", skill: readCatalogSkill(data) }
  } catch (error) {
    if (signal.aborted) throw error
    return { state: "error" }
  }
}

function Breadcrumb({ current }: { current: React.ReactNode }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex min-w-0 items-center gap-2 text-sm">
        <li className="shrink-0">
          <Link
            href="/skills"
            className="inline-flex items-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Skills
          </Link>
        </li>
        <li aria-hidden="true" className="text-subtle-foreground">
          /
        </li>
        <li aria-current="page" className="min-w-0 truncate text-foreground">
          {current}
        </li>
      </ol>
    </nav>
  )
}

function asPart<T, U>(load: Load<T>, value: (data: T) => U): Part<U> {
  return load.state === "ready" ? { state: "ready", value: value(load.data) } : load.state === "error" ? { state: "error" } : { state: "loading" }
}

export default function SkillDetailPage() {
  const params = useParams<{ skillId: string }>()
  const skillId = typeof params?.skillId === "string" ? params.skillId.toLowerCase() : ""
  const valid = isSkillId(skillId)
  const { profile } = useShellProfile()

  const [catalog, setCatalog] = useState<CatalogLoad>({ state: "loading" })
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [detail, setDetail] = useState<Load<SkillDetailResponse>>({ state: "loading" })
  const [evidence, setEvidence] = useState<Load<EvidenceResponse>>({ state: "loading" })
  const [detailAttempt, setDetailAttempt] = useState(0)
  const [evidenceAttempt, setEvidenceAttempt] = useState(0)

  // Each read runs once for this skill, and again only when its own retry is pressed.
  useEffect(() => {
    if (!valid) return
    const controller = new AbortController()
    setCatalog({ state: "loading" })
    loadCatalogSkill(skillId, controller.signal).then(setCatalog, () => {})
    return () => controller.abort()
  }, [skillId, valid, catalogAttempt])

  useEffect(() => {
    if (!valid) return
    const controller = new AbortController()
    setDetail({ state: "loading" })
    getJson(`/api/skills/progress?skillId=${skillId}`, readSkillDetailResponse, controller.signal).then(setDetail, () => {})
    return () => controller.abort()
  }, [skillId, valid, detailAttempt])

  useEffect(() => {
    if (!valid) return
    const controller = new AbortController()
    setEvidence({ state: "loading" })
    getJson(`/api/skills/evidence?skillId=${skillId}`, readEvidenceResponse, controller.signal).then(setEvidence, () => {})
    return () => controller.abort()
  }, [skillId, valid, evidenceAttempt])

  const retryCatalog = useCallback(() => setCatalogAttempt((n) => n + 1), [])
  const retryDetail = useCallback(() => setDetailAttempt((n) => n + 1), [])
  const retryEvidence = useCallback(() => setEvidenceAttempt((n) => n + 1), [])

  const detailPart = useMemo(() => asPart(detail, buildSkillDetail), [detail])
  const evidencePart = useMemo(
    () => asPart(evidence, (data) => buildEvidenceEntries(data.evidence, skillId)),
    [evidence, skillId]
  )

  const heading = skillHeading(valid, catalog, detail.state === "error" ? detail.status : null)
  const signedOut =
    (detail.state === "error" && detail.status === 401) || (evidence.state === "error" && evidence.status === 401)

  if (heading.kind === "not-found") {
    return (
      <div>
        <Breadcrumb current="Not found" />
        <EmptyState
          icon={SearchX}
          title="Skill not found"
          description="This link doesn't match a skill in SkillBridge's skill catalogue."
          action={
            <Link href="/skills" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <ArrowLeft />
              Back to Skills
            </Link>
          }
        />
      </div>
    )
  }

  if (signedOut) {
    return (
      <div>
        <Breadcrumb current={heading.kind === "ready" ? heading.skill.name : "Signed out"} />
        <ErrorState
          title="You're signed out"
          description="Sign in again to see this skill."
          action={
            <Link href="/login" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <LogIn />
              Sign in
            </Link>
          }
        />
      </div>
    )
  }

  if (heading.kind === "error") {
    return (
      <div>
        <Breadcrumb current="Couldn't load" />
        <ErrorState title="This skill couldn't load" description={failureText(null)} onRetry={retryCatalog} />
      </div>
    )
  }

  const record = detailPart.state === "ready" ? detailPart.value : null
  const entries = evidencePart.state === "ready" ? evidencePart.value : null
  // Name and category only ever come from the catalog record.
  const skill = heading.kind === "ready" ? heading.skill : null
  const targetRole = profile?.targetRole?.trim() || null

  return (
    <div>
      <Breadcrumb current={skill ? skill.name : <span className="skeleton inline-block h-3.5 w-20 align-middle" />} />

      {skill ? (
        <PageHeader
          eyebrow={<Eyebrow>{skill.category ?? "Uncategorised"}</Eyebrow>}
          title={<span className="[overflow-wrap:anywhere]">{skill.name}</span>}
          description="What SkillBridge currently knows about this skill for you: what you've claimed, what you're working on, and what you've shown."
          meta={
            record ? (
              <>
                <StatusBadge tone={record.claimed ? "primary" : "neutral"}>{record.claimed ? "Claimed" : "Not claimed"}</StatusBadge>
                <StatusBadge tone={record.progress?.status && record.progress.status !== "not_started" ? "primary" : "neutral"}>
                  {record.progress?.status ? STATUS_LABEL[record.progress.status] : "Not started"}
                </StatusBadge>
                {entries && (
                  <StatusBadge tone={entries.length > 0 ? "primary" : "neutral"}>
                    {entries.length > 0 ? `${entries.length} evidence ${entries.length === 1 ? "item" : "items"}` : "No evidence yet"}
                  </StatusBadge>
                )}
              </>
            ) : undefined
          }
        />
      ) : (
        <div role="status" aria-live="polite" className="mb-10">
          <span className="sr-only">Loading skill…</span>
          <div aria-hidden="true">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton mt-4 h-9 w-56" />
            <div className="skeleton mt-4 h-4 w-full max-w-xl" />
          </div>
        </div>
      )}

      {detail.state === "error" && (
        <Notice
          tone="warning"
          title="Couldn't load skill progress."
          className="mb-6"
          action={
            <button type="button" onClick={retryDetail} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Try again
            </button>
          }
        >
          {failureText(detail.status)} Your claim and progress for this skill aren&apos;t shown until it loads.
        </Notice>
      )}

      <SkillStatusPanel detail={detailPart} evidence={evidencePart} />

      <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-10">
        <SkillEvidence evidence={evidencePart} claimed={record ? record.claimed : null} onRetry={retryEvidence} />

        <div className="space-y-4">
          {record ? (
            <>
              <SkillClaim detail={record} />
              <SkillProgress detail={record} />
            </>
          ) : detail.state === "loading" ? (
            <>
              <SkillRecordSkeleton />
              <SkillRecordSkeleton />
            </>
          ) : null}
          <SkillNextSteps skillName={skill?.name ?? "this skill"} entries={entries} targetRole={targetRole} />
        </div>
      </div>
    </div>
  )
}
