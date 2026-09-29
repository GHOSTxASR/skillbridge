"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ClipboardCheck, Layers, LogIn, Route, ScanSearch, SearchX, Target, UserRoundPen } from "lucide-react"

import { useShellProfile } from "@/lib/profile-store"
import { failureText, getJson, type Load } from "@/lib/skills/load"
import {
  buildSkillCollection,
  categoriesOf,
  filterRecords,
  readEvidenceResponse,
  readProgressResponse,
  statusFilters,
  summarize,
  type EvidenceResponse,
  type ProgressResponse,
  type StatusFilter,
} from "@/lib/skills/view"
import { buttonVariants } from "@/components/ui/button"
import { Eyebrow, PageHeader, Section } from "@/components/ui/page"
import { EmptyState, ErrorState, Notice } from "@/components/ui/states"
import { SkillCard, SkillCardSkeleton } from "@/components/skills/skill-card"
import { SkillSummary, SkillSummarySkeleton } from "@/components/skills/skill-summary"
import { SkillToolbar } from "@/components/skills/skill-toolbar"

// The signed-in user's skills: what they claim, what they are working on, and what they
// have shown. Read-only: the page makes two GET requests, once, and never writes. The
// session decides whose data this is; no user id is ever sent.

const loadProgress = (signal: AbortSignal) => getJson("/api/skills/progress", readProgressResponse, signal)
const loadEvidence = (signal: AbortSignal) => getJson("/api/skills/evidence", readEvidenceResponse, signal)

function PageSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading your skills…</span>
      <SkillSummarySkeleton className="mb-12" />
      <div aria-hidden="true" className="mb-6 flex flex-col gap-3">
        <div className="skeleton h-10 w-full rounded-xl sm:max-w-sm" />
        <div className="skeleton h-10 w-full rounded-xl sm:w-[34rem]" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkillCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

export default function SkillsPage() {
  const { profile } = useShellProfile()
  const [progress, setProgress] = useState<Load<ProgressResponse>>({ state: "loading" })
  const [evidence, setEvidence] = useState<Load<EvidenceResponse>>({ state: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [evidenceAttempt, setEvidenceAttempt] = useState(0)

  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [category, setCategory] = useState<string | null>(null)

  // Once on load, and again only when the user asks to retry.
  useEffect(() => {
    const controller = new AbortController()
    setProgress({ state: "loading" })
    setEvidence({ state: "loading" })
    loadProgress(controller.signal).then(setProgress, () => {})
    loadEvidence(controller.signal).then(setEvidence, () => {})
    return () => controller.abort()
  }, [attempt])

  useEffect(() => {
    if (evidenceAttempt === 0) return
    const controller = new AbortController()
    setEvidence({ state: "loading" })
    loadEvidence(controller.signal).then(setEvidence, () => {})
    return () => controller.abort()
  }, [evidenceAttempt])

  const retryAll = useCallback(() => setAttempt((n) => n + 1), [])
  const retryEvidence = useCallback(() => setEvidenceAttempt((n) => n + 1), [])

  const collection = useMemo(() => {
    if (progress.state !== "ready" || evidence.state === "loading") return null
    return buildSkillCollection(progress.data, evidence.state === "ready" ? evidence.data : null)
  }, [progress, evidence])

  const targetRole = profile?.targetRole?.trim() || null

  const header = (
    <PageHeader
      eyebrow={<Eyebrow tone="primary">Your skill record</Eyebrow>}
      title="Skills"
      description="Turn what you're learning into demonstrated capability."
      meta={
        targetRole ? (
          <span className="inline-flex items-center gap-1.5">
            <Target aria-hidden="true" className="size-3.5 text-primary" />
            Building toward <span className="font-medium text-foreground">{targetRole}</span>
          </span>
        ) : undefined
      }
      actions={
        <Link href="/account" className={buttonVariants({ variant: "secondary" })}>
          <UserRoundPen />
          Edit profile skills
        </Link>
      }
    />
  )

  if (progress.state === "error") {
    return (
      <div>
        {header}
        {progress.status === 401 ? (
          <ErrorState
            title="You're signed out"
            description="Sign in again to see your skills."
            action={
              <Link href="/login" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                <LogIn />
                Sign in
              </Link>
            }
          />
        ) : (
          <ErrorState
            title="Your skills couldn't load"
            description={failureText(progress.status)}
            onRetry={retryAll}
          />
        )}
      </div>
    )
  }

  if (!collection) {
    return (
      <div>
        {header}
        <PageSkeleton />
      </div>
    )
  }

  const { records, unrecognised } = collection
  const options = statusFilters(collection)
  const categories = categoriesOf(records)
  const activeCategory = category && categories.includes(category) ? category : null
  const visible = filterRecords(records, { query, status, category: activeCategory })
  const filtered = query.trim() !== "" || status !== "all" || activeCategory !== null

  const clearFilters = () => {
    setQuery("")
    setStatus("all")
    setCategory(null)
  }

  return (
    <div>
      {header}

      {records.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={unrecognised.length > 0 ? "None of your profile skills can be tracked yet" : "No skills yet"}
          description={
            unrecognised.length > 0
              ? "The skills on your profile aren't in SkillBridge's skill catalogue, so there is nothing to track for them yet."
              : "Skills appear here once you add them to your profile or record them in the skill assessment. Nothing is filled in for you."
          }
          action={
            <>
              <Link href="/account" className={buttonVariants({ size: "sm" })}>
                <UserRoundPen />
                Add skills to your profile
              </Link>
              <Link href="/assessment" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                <ClipboardCheck />
                Skill assessment
              </Link>
            </>
          }
        />
      ) : (
        <>
          <SkillSummary summary={summarize(collection)} className="mb-12" />

          {evidence.state === "error" && (
            <Notice
              tone="warning"
              title="Evidence couldn't load"
              className="mb-8"
              action={
                <button
                  type="button"
                  onClick={retryEvidence}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  Try again
                </button>
              }
            >
              Your claims and progress are shown, but evidence isn&apos;t available right now. This doesn&apos;t mean
              you have none.
            </Notice>
          )}

          <Section
            title="Your skills"
            description={`${records.length} ${records.length === 1 ? "skill" : "skills"} from your profile, progress and evidence. Most recently active first.`}
          >
            <SkillToolbar
              query={query}
              onQueryChange={setQuery}
              status={status}
              onStatusChange={setStatus}
              statusOptions={options}
              category={activeCategory}
              onCategoryChange={setCategory}
              categories={categories}
            />

            <p className="sr-only" role="status" aria-live="polite">
              {filtered ? `${visible.length} of ${records.length} skills shown` : ""}
            </p>

            {visible.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="No skills match"
                description="Try a different search, status or category."
                action={
                  <button
                    type="button"
                    onClick={clearFilters}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    Clear filters
                  </button>
                }
              />
            ) : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((record, index) => (
                  <li key={record.skillId} className="min-w-0">
                    <SkillCard record={record} index={index} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      {unrecognised.length > 0 && (
        <Section
          title="Also on your profile"
          description="SkillBridge's skill catalogue doesn't include these yet, so progress and evidence can't be tracked for them."
          className="mt-14"
        >
          <ul className="flex flex-wrap gap-2">
            {unrecognised.map((name) => (
              <li
                key={name}
                className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-secondary-foreground ring-1 ring-inset ring-border"
              >
                {name}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {records.length > 0 && (
        <Section
          title="Where to go next"
          description={
            targetRole
              ? `Your gap analysis compares these skills with what ${targetRole} roles need; your roadmap orders what to learn next.`
              : "Set a target role on your profile to compare these skills with what it needs."
          }
          className="mt-16 border-t border-border pt-10"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NextLink
              href="/gap-analysis"
              icon={ScanSearch}
              title="See your skill gaps"
              text="Which skills your target role needs that you don't have yet, and why each one matters."
            />
            <NextLink
              href="/roadmap"
              icon={Route}
              title="Follow your learning roadmap"
              text="The skills to learn next, in order, with resources for each step."
            />
          </div>
        </Section>
      )}
    </div>
  )
}

function NextLink({
  href,
  icon: Icon,
  title,
  text,
}: {
  href: string
  icon: React.ElementType
  title: string
  text: string
}) {
  return (
    <Link
      href={href}
      className="pressable group flex items-start gap-4 rounded-2xl border border-border p-5 hover:border-border-strong hover:bg-surface-2/40"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-primary">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{text}</span>
      </span>
    </Link>
  )
}
