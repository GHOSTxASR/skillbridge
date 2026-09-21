import Link from "next/link"
import {
  Building2,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  ArrowRight,
} from "lucide-react"
import { readinessTarget, readinessBreakdown } from "@/lib/mock-data"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/card"
import { PageHeader } from "@/components/page-header"
import { ReadinessRing } from "@/components/readiness-ring"
import { ProgressBar } from "@/components/progress-bar"
import { StatusBadge } from "@/components/status-badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function scoreTone(score: number) {
  if (score >= 75) return "success" as const
  if (score >= 50) return "primary" as const
  return "warning" as const
}

export default function ReadinessPage() {
  const { overall, categories, strengths, toImprove, recommendation } =
    readinessBreakdown

  return (
    <div>
      <PageHeader
        title="Job Readiness"
        description="How prepared you are for a specific role, broken down by category."
        action={
          <Link href="/jobs" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Compare other roles
            <ArrowRight className="size-3.5" />
          </Link>
        }
      />

      {/* Target role + ring */}
      <Card className="mb-6">
        <CardContent className="flex flex-col items-center gap-6 p-6 md:flex-row md:justify-between">
          <div className="text-center md:text-left">
            <StatusBadge tone="primary">Selected role</StatusBadge>
            <h2 className="mt-3 text-xl font-semibold text-foreground">
              {readinessTarget.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground md:justify-start">
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="size-4" />
                {readinessTarget.company}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" />
                {readinessTarget.location}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2 md:justify-start">
              <StatusBadge tone="neutral">{readinessTarget.type}</StatusBadge>
              <StatusBadge tone="primary">{readinessTarget.salary}</StatusBadge>
              <StatusBadge tone="neutral">{readinessTarget.posted}</StatusBadge>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2 rounded-lg bg-secondary/50 px-8 py-5">
            <ReadinessRing value={overall} size={160} label="Ready" />
            <p className="text-xs text-muted-foreground">
              {overall >= 75 ? "Strong match" : "Close the gaps to apply"}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Category breakdown */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Readiness Breakdown</CardTitle>
              <span className="text-xs text-muted-foreground">Weighted score</span>
            </CardHeader>
            <CardContent className="space-y-5">
              {categories.map((cat) => (
                <div key={cat.name}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{cat.name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-medium">
                        weight {cat.weight}
                      </span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {cat.score}%
                      </span>
                    </span>
                  </div>
                  <ProgressBar value={cat.score} tone={scoreTone(cat.score)} />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Recommendation */}
          <Card className="mt-6 border-primary/20 bg-accent/40">
            <CardContent className="flex items-start gap-3 p-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Lightbulb className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  AI Recommendation
                </p>
                <p className="mt-1 text-sm text-muted-foreground text-pretty">
                  {recommendation}
                </p>
                <Link
                  href="/roadmap"
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "mt-3",
                  )}
                >
                  Start closing gaps
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Strengths + improve */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your Strengths</CardTitle>
              <CheckCircle2 className="size-4 text-success" />
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {strengths.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1.5 rounded-md border border-success/25 bg-success-muted px-2.5 py-1 text-xs font-medium text-success"
                >
                  <CheckCircle2 className="size-3.5" />
                  {s}
                </span>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Focus Areas</CardTitle>
              <AlertTriangle className="size-4 text-warning" />
            </CardHeader>
            <CardContent className="space-y-2.5">
              {toImprove.map((s) => (
                <div
                  key={s}
                  className="flex items-center gap-2 rounded-md border border-warning/20 bg-warning-muted/50 px-3 py-2.5"
                >
                  <AlertTriangle className="size-4 shrink-0 text-warning" />
                  <span className="text-sm font-medium text-foreground">{s}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
