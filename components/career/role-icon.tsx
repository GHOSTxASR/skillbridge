import {
  BarChart3,
  BrainCircuit,
  Cloud,
  Code2,
  Infinity as InfinityIcon,
  Layers,
  LayoutTemplate,
  Server,
  ShieldCheck,
} from "lucide-react"

// Illustrative icons for the career options in lib/career-options.ts (presentation only).
const ROLE_ICONS: Record<string, React.ElementType> = {
  "Backend Engineer": Server,
  "Frontend Developer": LayoutTemplate,
  "Full Stack Developer": Layers,
  "Data Analyst": BarChart3,
  "Data Scientist": BrainCircuit,
  "DevOps Engineer": InfinityIcon,
  "Cloud Engineer": Cloud,
  "Cybersecurity Analyst": ShieldCheck,
  "Software Engineer": Code2,
}

export function roleIcon(role: string | null | undefined): React.ElementType {
  return (role && ROLE_ICONS[role]) || Code2
}

// Descriptions for the experience levels in lib/career-options.ts.
export const LEVEL_TEXT: Record<string, string> = {
  Beginner: "New to the field, or less than a year of hands-on practice.",
  Intermediate: "One to three years building projects; comfortable with core tools.",
  Advanced: "Three or more years shipping production systems independently.",
  Professional: "Already working professionally in a related role.",
}
