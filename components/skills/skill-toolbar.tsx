import { ChevronDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FilterOption, StatusFilter } from "@/lib/skills/view"

// Search, status and category for the skills already on the page; filtering is local and
// never refetches.

const control =
  "h-10 w-full rounded-xl border border-border-strong bg-[oklch(0.13_0.01_262/60%)] text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-subtle-foreground focus:border-primary/60 focus:shadow-[0_0_0_4px_oklch(0.72_0.135_250/12%)]"

export function SkillToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  statusOptions,
  category,
  onCategoryChange,
  categories,
}: {
  query: string
  onQueryChange: (query: string) => void
  status: StatusFilter
  onStatusChange: (status: StatusFilter) => void
  statusOptions: FilterOption[]
  category: string | null
  onCategoryChange: (category: string | null) => void
  categories: string[]
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
          <label htmlFor="skill-search" className="sr-only">
            Search skills by name
          </label>
          <input
            id="skill-search"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search skills"
            autoComplete="off"
            className={cn(control, "pl-10 pr-3")}
          />
        </div>

        {categories.length > 1 && (
          <div className="relative sm:w-52">
            <label htmlFor="skill-category" className="sr-only">
              Category
            </label>
            <select
              id="skill-category"
              value={category ?? ""}
              onChange={(event) => onCategoryChange(event.target.value || null)}
              className={cn(control, "appearance-none pl-3.5 pr-9")}
            >
              <option value="">All categories</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
          </div>
        )}
      </div>

      {/* relative keeps the sr-only counts inside the scroll area, so they cannot widen the page. */}
      <div
        role="group"
        aria-label="Filter by status"
        className="relative -mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:w-fit sm:rounded-xl sm:bg-[oklch(0.13_0.01_262/60%)] sm:p-1 sm:ring-1 sm:ring-inset sm:ring-border"
      >
        {statusOptions.map((option) => {
          const active = option.id === status
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onStatusChange(option.id)}
              aria-pressed={active}
              className={cn(
                "pressable flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium",
                active
                  ? "bg-surface-2 text-foreground ring-1 ring-inset ring-border-strong"
                  : "text-muted-foreground ring-1 ring-inset ring-border hover:text-foreground sm:ring-0"
              )}
            >
              {option.label}
              <span className="tabular-nums text-subtle-foreground">
                {option.count}
                <span className="sr-only"> {option.count === 1 ? "skill" : "skills"}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
