# Sign-up and email verification

SkillBridge verifies new accounts with a **one-time code** sent by email (Supabase email OTP).
There is no confirmation link and no `/auth/callback` route.

## Flow

1. **Sign up** (`app/login/page.tsx`): `supabase.auth.signUp({ email, password, options: { data: { name } } })`.
   Supabase creates the unverified user and emails the "Confirm signup" template.
2. **Enter the code**: `supabase.auth.verifyOtp({ email, token, type: "email" })` verifies the
   email and signs the user in.
3. **Onboarding**: new accounts go to `/setup-profile`, which creates the `profiles` row. An
   account that already has a profile goes to `/`.

The shared rules (outcomes, messages, code length, onboarding decision) are in `lib/auth/flow.ts`.

## Required Supabase settings

These live in the Supabase dashboard, not in the repository.

- **Authentication → Sign In / Providers → Email**: email provider on, "Confirm email" on.
- **Authentication → Emails → Confirm signup**: the template must contain the code,
  `{{ .Token }}`, and must **not** contain `{{ .ConfirmationURL }}`. For example:

  ```html
  <h2>Confirm your SkillBridge account</h2>
  <p>Enter this code in SkillBridge to verify your email:</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
  <p>If you didn't create a SkillBridge account, you can ignore this email.</p>
  ```

- **Email OTP length** may be anything from 6 to 10 digits; the code field accepts that range.
- Emails sent with Supabase's built-in email service are heavily rate limited. A production
  project should use custom SMTP.

The Site URL and redirect URLs are not used by this flow. They should still point at the
deployed site, because other Supabase emails use them.

## Recovery

| Situation | What happens |
|---|---|
| Code screen refreshed | The tab remembers the pending email (sessionStorage) and shows the code screen again. |
| Code lost or expired | "Send a new code" (`supabase.auth.resend({ type: "signup" })`), with a 60-second cooldown. |
| Signed up but never verified, returns later | Sign-in answers `email_not_confirmed`; the page switches to the code screen with "Send a new code". |
| Signs up again with an unverified email | Supabase sends a new code; the code screen opens. |
| Signs up again with a verified email | Supabase sends nothing and returns a user without identities. The page says an account exists and offers "Sign in instead" or "Resend verification". No duplicate account is created. |
| Verified, but closed the tab before onboarding | On the next visit or sign-in, the app shell sees no profile and sends the user to `/setup-profile`. |
| Already signed in and opens `/login` | Redirected to `/`. |

## Temporary SIH demo mode (`SKILLBRIDGE_DEMO_AUTH`)

For the SIH judging demo, new accounts can skip the email code. Supabase's settings do not
change: "Confirm email" stays on, and nothing in the code changes the dashboard.

**How it works**

- The login page asks `GET /api/auth/demo-signup` whether demo mode is on. With it on, the
  sign-up form says "SIH demo: accounts are created without email verification."
- Sign-up posts `{ email, password, name }` to `POST /api/auth/demo-signup`. The server
  (`lib/auth/demo-signup.ts`, server-only) creates the account with the Supabase admin API.
- The page then signs in with the normal password sign-in, and the normal `/setup-profile`
  onboarding follows. Sessions, the guard, profile creation and sign-out are unchanged.
- **Existing emails:** `createUser` refuses an email that already has an account. No
  duplicate is created and no password is overwritten, and the page shows the usual
  "account already exists" message.
- **Abuse limit:** account creation is limited to 10 per client IP and 200 in total per
  10 minutes, per server instance. This is best effort.
- **Flag off:** `POST` answers 404 and `GET` says disabled, so the page uses the email-code
  flow above.

**Not identity verification.** Supabase only lets confirmed accounts sign in, so demo
accounts are created confirmed (`email_confirmed_at` is set). That does **not** mean the
email was verified. Every demo account also carries `app_metadata.skillbridge_demo_auth =
true`, which only the server can set. Use it to find those accounts later. Nothing in
SkillBridge treats demo accounts as verified.

**Enable (demo deployment only)**

1. Set `SUPABASE_SECRET_KEY` (already required for roadmap evidence) and
   `SKILLBRIDGE_DEMO_AUTH=true` in `.env.local` or the Vercel project's environment variables.
2. Restart the dev server, or redeploy on Vercel. Server environment variables are read at
   runtime; a Vercel change needs a new deployment to take effect.

**Revert to email verification**

1. Remove `SKILLBRIDGE_DEMO_AUTH` (or set it to anything other than `true`) wherever it was
   set, then restart or redeploy. Sign-up immediately goes back to the email code; no code
   change is needed.
2. Optional clean-up: in the Supabase SQL editor, list the accounts created in demo mode:
   `select id, email, created_at from auth.users where raw_app_meta_data ->> 'skillbridge_demo_auth' = 'true';`
   Then decide whether to keep, re-verify or delete them.
3. To remove the feature completely, delete `app/api/auth/demo-signup/route.ts` and
   `lib/auth/demo-signup.ts`. Also delete the `demoSignup` branch, the `demoAuth`/`demoCheck`
   state and the demo notice in `app/login/page.tsx`, the demo helpers in `lib/auth/flow.ts`,
   and the `SKILLBRIDGE_DEMO_AUTH` line in `.env.example`.

## Onboarding guard

`components/auth/auth-guard.tsx` wraps every page in the app shell. Page content renders only
when the signed-in user's `profiles` row exists. The row is read by `lib/profile-store.ts`,
limited to the user's own row by RLS. If the user has no row, the guard sends them to
`/setup-profile` before any page loads its data. A failed lookup is not treated as a missing
profile. `/setup-profile` needs a session only. Nothing creates a profile automatically.
