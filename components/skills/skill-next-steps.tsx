import Link from "next/link"
import { ArrowRight, BookOpen, ClipboardCheck, FolderGit2, Route, ScanSearch } from "lucide-react"
import { EVIDENCE_LABEL } from "@/lib/skills/view"
import { missingEvidenceKinds, type EvidenceEntry } from "@/lib/skills/detail"

// What this skill record does not have yet, and where the journey goes from here. It lists
// kinds of evidence that are absent (a fact about the record, not about ability) and links
// only to pages that already exist. Adding evidence from here comes in a later phase, so
// there is nothing to submit.

const KIND: Record<string, { icon: React.ElementType; label: string; text: string }> = {
  project: { icon: FolderGit2, label: "Projects", text: "Something you built that uses this skill." },
  learning: { icon: BookOpen, label: "Learning activity", text: "Courses, docs or roadmap steps you worked through." },
  assessment: { icon: ClipboardCheck, label: "Assessments", text: "A result SkillBridge measures itself." },
}

export function SkillNextSteps({
  skillName,
  entries,
  targetRole,
}: {
  skillName: string
  // null while evidence is loading or failed: nothing is listed as missing then.
  entries: EvidenceEntry[] | null
  targetRole: string | null
}) {
  const missing = entries ? missingEvidenceKinds(entries) : []

  return (
    <section aria-labelledby="skill-next" className="surface px-5 py-5">
      <h2 id="skill-next" className="type-eyebrow text-muted-foreground">
        What would strengthen this record
      </h2>

      {missing.length > 0 && (
        <>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            This record has no {missing.map((kind) => (EVIDENCE_LABEL[kind] ?? kind).toLowerCase()).join(", ").replace(/, ([^,]*)$/, " or $1")} evidence yet.
          </p>
          <ul className="mt-4 space-y-3">
            {missing.map((kind) => {
              const meta = KIND[kind]
              const Icon = meta?.icon ?? BookOpen
              return (
                <li key={kind} className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-foreground">{meta?.label ?? EVIDENCE_LABEL[kind] ?? kind}</span>
                    <span className="block text-muted-foreground">{meta?.text}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-4 text-xs text-subtle-foreground">
            Adding evidence here is coming later. For now, build it through your roadmap and projects.
          </p>
        </>
      )}

      <div className="mt-5 space-y-2 border-t border-border pt-4">
        <p className="text-xs text-subtle-foreground">
          {targetRole
            ? `Your gap analysis compares your skills with what ${targetRole} roles need.`
            : `Set a target role on your profile to see how ${skillName} fits the role you want.`}
        </p>
        <JourneyLink href="/gap-analysis" icon={ScanSearch} label="Gap analysis" />
        <JourneyLink href="/roadmap" icon={Route} label="Learning roadmap" />
      </div>
    </section>
  )
}

function JourneyLink({ href, icon: Icon, label }: { href: string; icon: React.ElementType; label: string }) {
  return (
    <Link
      href={href}
      className="pressable group flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
    >
      <Icon aria-hidden="true" className="size-4 text-primary" />
      {label}
      <ArrowRight aria-hidden="true" className="ml-auto size-4 text-subtle-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
