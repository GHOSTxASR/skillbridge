"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase-browser"

export default function SetupProfilePage() {
  const [name, setName] = useState("")
  const [targetRole, setTargetRole] = useState("")
  const [experience, setExperience] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    const savedName = localStorage.getItem("skillbridge_signup_name")

    if (savedName) {
      setName(savedName)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!name.trim() || !targetRole || !experience) {
      setMessage("Please complete all fields.")
      return
    }

    setLoading(true)
    setMessage("")

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      window.location.href = "/login"
      return
    }

    const { error } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        name: name.trim(),
        target_role: targetRole,
        experience_level: experience,
        job_readiness: 0,
        skills_mastered: 0,
        skill_gaps: 0,
        learning_progress: 0,
      })

    if (error) {
      setMessage(error.message)
      setLoading(false)
      return
    }

    localStorage.removeItem("skillbridge_signup_name")

    window.location.href = "/"
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">

        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white">
            Welcome to Skill<span className="text-blue-500">Bridge</span>
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            Let's personalize your career dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Your Name
            </label>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              What role are you targeting?
            </label>

            <select
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none focus:border-blue-500"
            >
              <option value="">Select target role</option>
              <option value="Backend Engineer">Backend Engineer</option>
              <option value="Frontend Developer">Frontend Developer</option>
              <option value="Full Stack Developer">Full Stack Developer</option>
              <option value="Data Analyst">Data Analyst</option>
              <option value="Data Scientist">Data Scientist</option>
              <option value="DevOps Engineer">DevOps Engineer</option>
              <option value="Cloud Engineer">Cloud Engineer</option>
              <option value="Cybersecurity Analyst">Cybersecurity Analyst</option>
              <option value="Software Engineer">Software Engineer</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Experience Level
            </label>

            <select
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none focus:border-blue-500"
            >
              <option value="">Select experience level</option>
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
              <option value="Professional">Professional</option>
            </select>
          </div>

          {message && (
            <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Setting up your profile..." : "Continue to Dashboard"}
          </button>

        </form>
      </div>
    </main>
  )
}
