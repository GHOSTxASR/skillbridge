// Central mock data source for the SkillBridge prototype.
// Shaped to mirror likely API responses so screens can swap to real
// endpoints later without structural changes.

export type SkillStatus = "mastered" | "in-progress" | "gap"

export type Skill = {
  name: string
  status: SkillStatus
  // 0-100 proficiency the  currently has
  proficiency: number
  // 0-100 proficiency the target role expects
  required: number
  category: string
}

export type Role = {
  id: string
  title: string
  demand: "High" | "Medium" | "Low"
}

export type Course = {
  id: string
  title: string
  provider: string
  skill: string
  level: "Beginner" | "Intermediate" | "Advanced"
  duration: string
  progress: number // 0-100
  rating: number
}

export type Job = {
  id: string
  title: string
  company: string
  location: string
  type: "Full-time" | "Internship" | "Contract"
  salary: string
  posted: string
  readiness: number // 0-100 match for the current 
  matchedSkills: string[]
  missingSkills: string[]
  tags: string[]
}

export type Activity = {
  id: string
  label: string
  detail: string
  time: string
  type: "course" | "assessment" | "job" | "skill"
}

export type RoadmapPhase = {
  id: string
  title: string
  status: "completed" | "active" | "upcoming"
  duration: string
  description: string
  skills: string[]
  courses: string[]
}

export const targetRoles: Role[] = [
  { id: "backend", title: "", demand: "High" },
  { id: "frontend", title: "Frontend Developer", demand: "High" },
  { id: "fullstack", title: "Full Stack Developer", demand: "High" },
  { id: "data-analyst", title: "Data Analyst", demand: "Medium" },
  { id: "data-scientist", title: "Data Scientist", demand: "High" },
  { id: "devops", title: "DevOps Engineer", demand: "Medium" },
  { id: "security", title: "Cybersecurity Engineer", demand: "Medium" },
]

export const experienceLevels = ["Beginner", "Intermediate", "Advanced"] as const

export const allSkills = [
  "C++",
  "Python",
  "Java",
  "JavaScript",
  "TypeScript",
  "DSA",
  "SQL",
  "Git",
  "React",
  "Node.js",
  "REST APIs",
  "Docker",
  "AWS",
  "Linux",
  "MongoDB",
  "PostgreSQL",
]

export const user = {
  name: "",
  initials: "AS",
  targetRole: "",
  experience: "Intermediate",
  jobReadiness: 68,
  skillsMastered: 9,
  skillGaps: 4,
  learningProgress: 54,
}

export const skills: Skill[] = [
  { name: "Python", status: "mastered", proficiency: 90, required: 80, category: "Languages" },
  { name: "SQL", status: "mastered", proficiency: 85, required: 80, category: "Databases" },
  { name: "Git", status: "mastered", proficiency: 88, required: 70, category: "Tooling" },
  { name: "DSA", status: "mastered", proficiency: 82, required: 80, category: "Fundamentals" },
  { name: "REST APIs", status: "mastered", proficiency: 78, required: 75, category: "Backend" },
  { name: "Linux", status: "mastered", proficiency: 80, required: 70, category: "Systems" },
  { name: "Java", status: "mastered", proficiency: 75, required: 65, category: "Languages" },
  { name: "PostgreSQL", status: "mastered", proficiency: 72, required: 70, category: "Databases" },
  { name: "MongoDB", status: "mastered", proficiency: 70, required: 65, category: "Databases" },
  { name: "Node.js", status: "in-progress", proficiency: 55, required: 80, category: "Backend" },
  { name: "Docker", status: "in-progress", proficiency: 45, required: 75, category: "DevOps" },
  { name: "AWS", status: "gap", proficiency: 20, required: 75, category: "Cloud" },
  { name: "System Design", status: "gap", proficiency: 15, required: 80, category: "Architecture" },
  { name: "Kubernetes", status: "gap", proficiency: 5, required: 65, category: "DevOps" },
  { name: "Redis", status: "gap", proficiency: 10, required: 60, category: "Databases" },
]

export const courses: Course[] = [
  {
    id: "c1",
    title: "Node.js Backend Masterclass",
    provider: "SkillBridge Academy",
    skill: "Node.js",
    level: "Intermediate",
    duration: "6 weeks",
    progress: 60,
    rating: 4.7,
  },
  {
    id: "c2",
    title: "Docker & Containers in Practice",
    provider: "CloudNative Institute",
    skill: "Docker",
    level: "Intermediate",
    duration: "4 weeks",
    progress: 35,
    rating: 4.6,
  },
  {
    id: "c3",
    title: "AWS Cloud Practitioner to Developer",
    provider: "SkillBridge Academy",
    skill: "AWS",
    level: "Beginner",
    duration: "8 weeks",
    progress: 0,
    rating: 4.8,
  },
  {
    id: "c4",
    title: "Scalable System Design",
    provider: "Backend Guild",
    skill: "System Design",
    level: "Advanced",
    duration: "10 weeks",
    progress: 0,
    rating: 4.9,
  },
  {
    id: "c5",
    title: "Kubernetes Fundamentals",
    provider: "CloudNative Institute",
    skill: "Kubernetes",
    level: "Beginner",
    duration: "5 weeks",
    progress: 0,
    rating: 4.5,
  },
  {
    id: "c6",
    title: "Caching with Redis",
    provider: "Backend Guild",
    skill: "Redis",
    level: "Intermediate",
    duration: "3 weeks",
    progress: 0,
    rating: 4.4,
  },
]

export const jobs: Job[] = [
  {
    id: "j1",
    title: "",
    company: "Infosys",
    location: "Bengaluru, KA",
    type: "Full-time",
    salary: "₹12–18 LPA",
    posted: "2 days ago",
    readiness: 78,
    matchedSkills: ["Python", "SQL", "REST APIs", "PostgreSQL", "Git"],
    missingSkills: ["AWS", "System Design"],
    tags: ["Microservices", "PostgreSQL", "REST"],
  },
  {
    id: "j2",
    title: "Software Engineer — Backend",
    company: "Zoho",
    location: "Chennai, TN",
    type: "Full-time",
    salary: "₹10–15 LPA",
    posted: "4 days ago",
    readiness: 71,
    matchedSkills: ["Java", "SQL", "DSA", "Git"],
    missingSkills: ["Docker", "AWS"],
    tags: ["Java", "Distributed Systems"],
  },
  {
    id: "j3",
    title: "Platform Engineer",
    company: "Freshworks",
    location: "Remote, India",
    type: "Full-time",
    salary: "₹14–20 LPA",
    posted: "1 week ago",
    readiness: 58,
    matchedSkills: ["Python", "Linux", "REST APIs"],
    missingSkills: ["Docker", "Kubernetes", "AWS"],
    tags: ["Cloud", "Kubernetes", "CI/CD"],
  },
  {
    id: "j4",
    title: "Backend Developer Intern",
    company: "Razorpay",
    location: "Bengaluru, KA",
    type: "Internship",
    salary: "₹40k/month",
    posted: "3 days ago",
    readiness: 84,
    matchedSkills: ["Python", "SQL", "REST APIs", "Git", "MongoDB"],
    missingSkills: ["Docker"],
    tags: ["Payments", "Node.js", "MongoDB"],
  },
  {
    id: "j5",
    title: "API Engineer",
    company: "Postman",
    location: "Hyderabad, TS",
    type: "Full-time",
    salary: "₹16–22 LPA",
    posted: "5 days ago",
    readiness: 64,
    matchedSkills: ["REST APIs", "Node.js", "Git"],
    missingSkills: ["AWS", "System Design"],
    tags: ["API", "Node.js", "Cloud"],
  },
]

export const activities: Activity[] = [
  {
    id: "a1",
    label: "Completed lesson",
    detail: "Async Patterns in Node.js Backend Masterclass",
    time: "2 hours ago",
    type: "course",
  },
  {
    id: "a2",
    label: "New job match",
    detail: "Backend Developer Intern at Razorpay — 84% ready",
    time: "1 day ago",
    type: "job",
  },
  {
    id: "a3",
    label: "Skill improved",
    detail: "Docker proficiency increased to 45%",
    time: "2 days ago",
    type: "skill",
  },
  {
    id: "a4",
    label: "Assessment updated",
    detail: "Re-ran skill gap analysis for ",
    time: "3 days ago",
    type: "assessment",
  },
  {
    id: "a5",
    label: "Skill mastered",
    detail: "PostgreSQL marked as mastered",
    time: "5 days ago",
    type: "skill",
  },
]

export const roadmap: RoadmapPhase[] = [
  {
    id: "p1",
    title: "Foundations Consolidated",
    status: "completed",
    duration: "Weeks 1–3",
    description:
      "Core backend fundamentals, data structures, and relational databases are solid and verified.",
    skills: ["Python", "SQL", "DSA", "REST APIs"],
    courses: ["Backend Fundamentals", "SQL Deep Dive"],
  },
  {
    id: "p2",
    title: "Server-Side Depth",
    status: "active",
    duration: "Weeks 4–7",
    description:
      "Build production-grade services with Node.js and containerize them with Docker.",
    skills: ["Node.js", "Docker"],
    courses: ["Node.js Backend Masterclass", "Docker & Containers in Practice"],
  },
  {
    id: "p3",
    title: "Cloud & Scale",
    status: "upcoming",
    duration: "Weeks 8–12",
    description:
      "Deploy to AWS, learn scalable system design, and add caching with Redis.",
    skills: ["AWS", "System Design", "Redis"],
    courses: ["AWS Cloud Practitioner to Developer", "Scalable System Design"],
  },
  {
    id: "p4",
    title: "Orchestration & Job Readiness",
    status: "upcoming",
    duration: "Weeks 13–16",
    description:
      "Master Kubernetes, complete mock interviews, and reach full readiness for target roles.",
    skills: ["Kubernetes"],
    courses: ["Kubernetes Fundamentals", "Backend Interview Prep"],
  },
]

// Job-specific readiness breakdown (used on the Job Readiness screen).
export const readinessTarget = jobs[0]

export const readinessBreakdown = {
  overall: readinessTarget.readiness,
  categories: [
    { name: "Technical Skills", score: 82, weight: "40%" },
    { name: "Tooling & DevOps", score: 48, weight: "25%" },
    { name: "System Design", score: 40, weight: "20%" },
    { name: "Fundamentals (DSA)", score: 88, weight: "15%" },
  ],
  strengths: ["Python", "SQL", "REST APIs", "PostgreSQL", "DSA", "Git"],
  toImprove: ["AWS", "System Design", "Docker"],
  recommendation:
    "You are strongly aligned on core backend skills. Close the AWS and System Design gaps to move from 78% to interview-ready (90%+).",
}

