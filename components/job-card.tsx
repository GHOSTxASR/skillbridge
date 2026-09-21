import { MapPin, Building2, Clock, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Job } from "@/lib/mock-data"
import { Card } from "@/components/card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"

function readinessBarColor(readiness: number) {
  if (readiness >= 75) return "bg-success"
  if (readiness >= 55) return "bg-warning"
  return "bg-destructive"
}

export function JobCard({
  job,
  compact = false,
}: {
  // Live jobs from /api/jobs carry no tags (never rendered here) and a free-form
  // type ("Remote" / "On-site"), so the prop accepts what the card actually shows.
  job: Omit<Job, "tags" | "type"> & { type: string }
  compact?: boolean
}) {
  return (
    <Card className="flex flex-col p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">
            {job.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3.5" />
              {job.company}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {job.location}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums text-foreground">
            {job.readiness}%
          </p>
          <p className="text-[11px] text-muted-foreground">ready</p>
        </div>
      </div>

      <div className="mt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={cn("h-full rounded-full", readinessBarColor(job.readiness))}
            style={{ width: `${job.readiness}%` }}
          />
        </div>
      </div>

      {!compact && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusBadge tone="neutral">{job.type}</StatusBadge>
            <StatusBadge tone="primary">{job.salary}</StatusBadge>
            {job.missingSkills.length > 0 && (
              <StatusBadge tone="warning">
                {job.missingSkills.length} skill gap
                {job.missingSkills.length > 1 ? "s" : ""}
              </StatusBadge>
            )}
          </div>

          <div className="mt-4 space-y-1.5 text-xs">
            <p className="text-muted-foreground">
              <span className="font-medium text-success">Matched: </span>
              {job.matchedSkills.slice(0, 4).join(", ")}
            </p>
            {job.missingSkills.length > 0 && (
              <p className="text-muted-foreground">
                <span className="font-medium text-warning">Missing: </span>
                {job.missingSkills.join(", ")}
              </p>
            )}
          </div>
        </>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3.5" />
          {job.posted}
        </span>
        <Button variant="ghost" size="sm">
          View role
          <ArrowRight className="size-3.5" />
        </Button>
      </div>
    </Card>
  )
}
