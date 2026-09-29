# Per-user AI generation limits (P1.8)

## Why this exists

P1.7 protects the shared Groq quota. It stops paying twice for one generation through
in-process request de-duplication and persistent caches (`career_analyses`, `learning_roadmaps`).
It also stops retry storms: one attempt per request, and a pause after a Groq 429.

P1.7 does not stop one signed-in user from asking for new generations on purpose, for
example by repeating `?refresh=1` or sending chat messages in a loop, until the organisation
quota runs out for everyone. P1.8 closes that gap with **per-user admission control**. Before
a route asks Groq for anything new, the database must admit the request for that user.

|                | P1.7                                                  | P1.8                                              |
|----------------|-------------------------------------------------------|---------------------------------------------------|
| Protects       | the shared Groq organisation quota                    | fairness between users; abuse by one account      |
| Mechanism      | in-flight de-dup, persistent caches, 429 pause        | per-user counters in Postgres                     |
| Scope          | per server process (dedup, pause); database (caches)  | database: shared by every server instance         |

## What is limited

| Operation         | Route(s)                                  | Per 10 minutes | Per hour |
|-------------------|-------------------------------------------|---------------:|---------:|
| `chat`            | `POST /api/ai` (chat and analysis mode)   | 20             | 60       |
| `career_analysis` | `POST /api/ai/career-analysis`            | 5              | 15       |
| `learning`        | `GET /api/learning`                       | 3              | 10       |

Both windows must have room. The limits are defined in `public.consume_ai_generation()`
(`supabase/migrations/20260922180000_p1_ai_rate_limits.sql`). Changing them means replacing
that function in a new migration.

Why these values:

- Each generation reserves roughly 1.5k (chat) to 3.5k (analysis, roadmap) tokens against an
  organisation budget of about 8,000 tokens per minute. The whole app can therefore afford
  only a few generations per minute.
- The limits are far above normal use, which never reaches them:
  - A skill-gap analysis or roadmap is generated once, then served from the cache until the
    profile changes or the user presses Refresh.
  - 20 chat messages in 10 minutes is one every 30 seconds.
- They stop one account from holding a large share of the organisation budget for long.

## What counts as a generation

A request counts when it is admitted to the AI path:

- a chat message, or `/api/ai` analysis mode;
- a career-analysis or learning **cache miss** (no stored result for the current inputs);
- an explicit **`?refresh=1`**.

An admitted request stays counted even if Groq then fails. Otherwise failing requests could
be repeated without limit. The following never count:

- **cache hits**, including every normal dashboard, roadmap and gap-analysis load while
  the cache is valid;
- invalid requests (400), unauthenticated requests (401), a missing profile (409);
- requests that were refused (429).

Identical concurrent requests on one server share one admission and one Groq call through
P1.7's in-flight de-duplication, for example React Strict Mode, two tabs, or a double-click
on Refresh.

**Why cache hits don't count:** they cost nothing at Groq, and counting them would punish
ordinary page loads without protecting anything.

## Why it is database-backed

On Vercel every request can run on a different serverless instance, and instances start and
stop at will. A counter in memory (a `Map`, a module variable) would be per instance and lost
on every cold start, so a user could multiply their limit by the number of instances.

The counts therefore live in `public.ai_rate_limits`, with one row per user and operation:

- `consume_ai_generation()` locks the user's row, applies the window reset, checks and counts
  in a single transaction. Simultaneous requests queue on the row lock, so no two of them can
  both see the last free slot.
- It is `SECURITY DEFINER` with an empty `search_path`. Its only argument is the operation
  name, and it always acts on `auth.uid()`: a user can use up their own allowance but cannot
  touch anyone else's.
- The table has RLS with no policies and no privileges for `anon` or `authenticated`. Nobody
  can read, reset or edit counts directly. Only `authenticated` may execute the function.
- The table holds at most 3 rows per user. Rows are removed with the auth user
  (`ON DELETE CASCADE`), so no cleanup job is needed.

## Windows and Retry-After

- The windows are fixed: 10 minutes and 1 hour, aligned to the UTC epoch (`date_bin`), and
  timed by the database clock. The client never supplies a timestamp.
- When a window is full, the route returns **HTTP 429** with:
  - `Retry-After`: the seconds until every full window has reset, rounded up. A full hour
    window takes precedence over the 10-minute one.
  - the body `{ "error": "rate_limited", "message": "You've reached the AI request limit. Please try again in N minutes.", "retryAfterSeconds": n }`.
- This is not Groq's own 429. That one is still reported as a 200 with the fallback or the
  saved result and `reason: "rate_limited"`.
- A refused refresh gets the 429 even when a saved result exists. The UI keeps showing the
  saved analysis or roadmap and adds the message.

## Known limitations

- **Fixed-window bursts.** Fixed windows allow a burst at a boundary: 3 roadmap refreshes at
  10:09 and 3 more at 10:10. The hourly ceiling bounds this.
- **Per-instance de-duplication.** Identical requests handled by different instances at the
  same moment each use an allowance. They are still limited.
- **Fail-closed checks.** If the limiter itself cannot be reached (database error, function
  missing), nothing is sent to Groq and the route answers as it does when AI is unavailable.
  Apply the migration before deploying the code.
- **No aggregate protection.** Per-user limits do not cap the whole organisation: many
  accounts together can still exhaust Groq's quota. P1.7's pause still applies.
- **Admission during a Groq pause.** A request admitted while P1.7 has paused Groq after a
  429 is counted, even though no Groq call is made.
- **Self-consumption.** A signed-in user can call the RPC directly. They can only use up their
  own allowance, and the Supabase security advisor may flag the `SECURITY DEFINER` function
  for review.
