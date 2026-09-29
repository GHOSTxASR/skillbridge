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

## Onboarding guard

`components/auth/auth-guard.tsx` wraps every page in the app shell. Page content renders only
when the signed-in user's `profiles` row exists. The row is read by `lib/profile-store.ts`,
limited to the user's own row by RLS. If the user has no row, the guard sends them to
`/setup-profile` before any page loads its data. A failed lookup is not treated as a missing
profile. `/setup-profile` needs a session only. Nothing creates a profile automatically.
