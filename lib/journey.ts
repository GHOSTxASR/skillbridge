import {
  LayoutGrid,
  UserRound,
  ClipboardCheck,
  ScanSearch,
  Route,
  BriefcaseBusiness,
  Gauge,
  Layers,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

// The product's information architecture: SkillBridge is one career journey, not a
// set of separate tools. Navigation, page eyebrows and the dashboard all read from
// this list, so a future stage (projects, applications, outcomes) is added in one place.

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  // Journey stage name and position, for journey items only.
  stage?: string
  step?: number
  description?: string
}

export const OVERVIEW: NavItem = {
  href: "/",
  label: "Dashboard",
  icon: LayoutGrid,
}

// The user's skill record (claims, progress, evidence). Not a journey step: every stage
// feeds it.
export const SKILLS: NavItem = {
  href: "/skills",
  label: "Skills",
  icon: Layers,
}

export const JOURNEY: NavItem[] = [
  {
    href: "/account",
    label: "Profile",
    icon: UserRound,
    stage: "You",
    step: 0,
    description: "Who you are and where you want to go",
  },
  {
    href: "/assessment",
    label: "Skill assessment",
    icon: ClipboardCheck,
    stage: "Assess",
    step: 1,
    description: "Record your target role, skills and experience",
  },
  {
    href: "/gap-analysis",
    label: "Gap analysis",
    icon: ScanSearch,
    stage: "Understand",
    step: 2,
    description: "What the role needs and what you already have",
  },
  {
    href: "/roadmap",
    label: "Learning roadmap",
    icon: Route,
    stage: "Learn",
    step: 3,
    description: "An ordered path through the skills you need",
  },
  {
    href: "/jobs",
    label: "Jobs",
    icon: BriefcaseBusiness,
    stage: "Apply",
    step: 4,
    description: "Live openings ranked against your profile",
  },
  {
    href: "/readiness",
    label: "Readiness",
    icon: Gauge,
    stage: "Check",
    step: 5,
    description: "Your target role's requirements next to your skills",
  },
]

export const ASSISTANT: NavItem = {
  href: "/ai",
  label: "Assistant",
  icon: Sparkles,
}

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)
}

export function journeyItem(href: string): NavItem | undefined {
  return JOURNEY.find((item) => item.href === href)
}

export function currentNavItem(pathname: string): NavItem | undefined {
  return [OVERVIEW, SKILLS, ...JOURNEY, ASSISTANT].find((item) => isActive(pathname, item.href))
}
