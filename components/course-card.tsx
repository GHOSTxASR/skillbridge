import { Star, Clock, PlayCircle, BookOpen } from "lucide-react"
import type { Course } from "@/lib/mock-data"
import { Card } from "@/components/card"
import { StatusBadge } from "@/components/status-badge"
import { ProgressBar } from "@/components/progress-bar"
import { Button } from "@/components/ui/button"

export function CourseCard({ course }: { course: Course }) {
  const started = course.progress > 0
  const completed = course.progress >= 100

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
          <BookOpen className="size-5" />
        </span>
        <StatusBadge tone="neutral">{course.level}</StatusBadge>
      </div>

      <h3 className="mt-3 text-base font-semibold leading-snug text-foreground text-pretty">
        {course.title}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{course.provider}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3.5" />
          {course.duration}
        </span>
        <span className="inline-flex items-center gap-1">
          <Star className="size-3.5 fill-warning text-warning" />
          {course.rating.toFixed(1)}
        </span>
        <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">
          {course.skill}
        </span>
      </div>

      {started && (
        <div className="mt-4">
          <ProgressBar
            value={course.progress}
            tone={completed ? "success" : "primary"}
            size="sm"
            label="Progress"
            showLabel
          />
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <Button
          variant={started ? "default" : "outline"}
          size="sm"
          className="w-full"
        >
          <PlayCircle className="size-4" />
          {completed ? "Review" : started ? "Continue" : "Start course"}
        </Button>
      </div>
    </Card>
  )
}
