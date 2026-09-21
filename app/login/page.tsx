"use client"

import { useState, type FormEvent } from "react"
import { supabase } from "@/lib/supabase-browser"

export default function LoginPage() {
  const [isSignup, setIsSignup] = useState(false)
  const [isVerify, setIsVerify] = useState(false)

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [otp, setOtp] = useState("")

  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")

  async function handleSignup(e: FormEvent) {
    e.preventDefault()

    if (!name.trim()) {
      setMessage("Please enter your name.")
      return
    }

    setLoading(true)
    setMessage("")

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          name: name.trim(),
        },
      },
    })

    if (error) {
      setMessage(error.message)
      setLoading(false)
      return
    }

    localStorage.setItem(
      "skillbridge_signup_name",
      name.trim()
    )

    setIsVerify(true)
    setMessage("Verification code sent to your email.")
    setPassword("")
    setLoading(false)
  }

  async function verifyEmail(e: FormEvent) {
    e.preventDefault()

    if (otp.length !== 6) {
      setMessage("Please enter the 6-digit verification code.")
      return
    }

    setLoading(true)
    setMessage("")

    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp,
      type: "email",
    })

    if (error) {
      setMessage(error.message)
      setLoading(false)
      return
    }

    if (!data.user) {
      setMessage("Verification failed. Please try again.")
      setLoading(false)
      return
    }

    /*
      OTP verified successfully.

      User is now authenticated.
      Send the NEW user to profile setup.
    */

    window.location.replace("/setup-profile")
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault()

    setLoading(true)
    setMessage("")

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      setMessage(error.message)
      setLoading(false)
      return
    }

    window.location.replace("/")
  }

  async function handleSubmit(e: FormEvent) {
    if (isVerify) {
      await verifyEmail(e)
      return
    }

    if (isSignup) {
      await handleSignup(e)
      return
    }

    await handleLogin(e)
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 px-4">

      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">

        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white">
            Skill<span className="text-blue-500">Bridge</span>
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            Bridge your skills to your career
          </p>
        </div>

        {isVerify ? (

          <>
            <div className="mb-6 text-center">

              <h2 className="text-2xl font-semibold text-white">
                Verify your email
              </h2>

              <p className="mt-2 text-sm text-slate-400">
                We sent a verification code to
              </p>

              <p className="mt-1 text-sm font-medium text-blue-400">
                {email}
              </p>

            </div>

            <form onSubmit={handleSubmit} className="space-y-5">

              <div>

                <label
                  htmlFor="otp"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Verification Code
                </label>

                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="Enter 6-digit code"
                  required
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-center text-xl tracking-[0.4em] text-white outline-none placeholder:text-slate-500 focus:border-blue-500"
                />

              </div>

              {message && (
                <p className="rounded-lg bg-blue-500/10 p-3 text-sm text-blue-400">
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify Email"}
              </button>

            </form>

            <button
              type="button"
              onClick={() => {
                setIsVerify(false)
                setIsSignup(false)
                setOtp("")
                setMessage("")
              }}
              className="mt-5 w-full text-center text-sm text-slate-400 hover:text-white"
            >
              Back to Login
            </button>

          </>

        ) : (

          <>
            <div className="mb-6">

              <h2 className="text-2xl font-semibold text-white">
                {isSignup ? "Create your account" : "Welcome back"}
              </h2>

              <p className="mt-1 text-sm text-slate-400">
                {isSignup
                  ? "Create an account to start your SkillBridge journey"
                  : "Login to continue to SkillBridge"}
              </p>

            </div>

            <form onSubmit={handleSubmit} className="space-y-5">

              {isSignup && (
                <div>

                  <label
                    htmlFor="name"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Full Name
                  </label>

                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your name"
                    required
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-blue-500"
                  />

                </div>
              )}

              <div>

                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Email
                </label>

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-blue-500"
                />

              </div>

              <div>

                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Password
                </label>

                <div className="relative">

                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    minLength={6}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 pr-16 text-white outline-none placeholder:text-slate-500 focus:border-blue-500"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowPassword(!showPassword)
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 hover:text-white"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>

                </div>

              </div>

              {message && (
                <p className="rounded-lg bg-blue-500/10 p-3 text-sm text-blue-400">
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? isSignup
                    ? "Creating account..."
                    : "Logging in..."
                  : isSignup
                    ? "Create Account"
                    : "Login"}
              </button>

            </form>

            <p className="mt-7 text-center text-sm text-slate-400">

              {isSignup
                ? "Already have an account?"
                : "Don't have an account?"}{" "}

              <button
                type="button"
                onClick={() => {
                  setIsSignup(!isSignup)
                  setMessage("")
                }}
                className="font-medium text-blue-400 hover:text-blue-300"
              >
                {isSignup ? "Login" : "Sign up"}
              </button>

            </p>

          </>

        )}

      </div>

    </main>
  )
}

