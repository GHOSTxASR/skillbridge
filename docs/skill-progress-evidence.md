# Skill progress and evidence (data foundation)

## The four concepts, kept apart

| Concept    | Question it answers                              | Where it lives                                         | Who writes it                |
|------------|--------------------------------------------------|--------------------------------------------------------|------------------------------|
| Claim      | What does the user say they know?                | `profiles.skills` (names), `user_skills` (unused)      | the user (assessment, account page) |
| Progress   | What has the user done with a skill?             | `skill_progress.status`, `learning_progress`, `practice_progress` | the user (status), evidence (trigger) |
| Evidence   | What has the user shown?                         | `skill_evidence` (assessment, project, learning)       | the user (project, learning); SkillBridge only (assessment) |
| Confidence | How sure is SkillBridge of the user's ability?   | `skill_progress.confidence_score`                      | nobody yet: NULL until a confidence model exists |

Readiness (how the user compares with a role or job) is unchanged in this phase.

A claim is never turned into progress, evidence or confidence. "I know React" on the profile
stays a claim; `GET /api/skills/progress` reports it as `selfReported`, next to (not merged
with) the evidence-based fields.

## Data model

Migration: `supabase/migrations/20260928000000_skill_progress_evidence.sql`.

- **`skills`** stays the only skill identity; both new tables reference `skills(id)`. The
  migration adds a case-insensitive unique index on names and the 16 skills the assessment
  offers when they are missing. Phase 1.5 grows the catalog, adds explicit aliases and a
  shared resolver; see [skill-catalog.md](skill-catalog.md). Names the catalog still cannot
  resolve stay unresolved (reported, not dropped) and cannot carry evidence until added.
- **`skill_progress`**: one row per (user, skill). `status` is `not_started`, `learning`,
  `practicing`, `assessed` or `proven`. The confidence and progress percentages are NULL
  (unknown) until measured. It also stores the latest assessment and first and last activity.
- **`skill_evidence`**: many rows per (user, skill). Each row has a type, title, description,
  `source_url`, `score` (assessment only, 0-100), `assessment_id` (assessment only, and it must
  be the same user's assessment), `group_id` (one project spanning several skills), `metadata`
  (a per-type JSON object of at most 4 KB), `observed_at` and `retracted_at`.
- **`assessments`** gains a unique `(id, user_id)` key, so that assessment evidence can require
  an assessment belonging to the same user.

Metadata per type:

| Type         | metadata                                                     | Written by |
|--------------|--------------------------------------------------------------|------------|
| `project`    | `{ demo_url? }`; the repository link is `source_url`          | user       |
| `learning`   | `{ roadmap_input_hash, roadmap_step, roadmap_skill }` (all or none; the step must be in the user's current roadmap when recorded) | user |
| `assessment` | free, for example `{ max_score }`; needs `assessment_id` and `score` | SkillBridge only |

Roadmap steps have no stable ids. The roadmap row is replaced whenever the profile inputs
change, so a learning record keeps a snapshot of the step (hash, order and skill), not a
foreign key.

## Authority and ownership

- Row-level security lets owners **SELECT** their own rows (`auth.uid() = user_id`). There
  are no INSERT, UPDATE or DELETE privileges; anon gets nothing.
- Every write goes through four `SECURITY DEFINER` functions. Only `authenticated` can run
  them, they have no user parameter and always act on `auth.uid()`:
  - `set_skill_progress_status(skill, status)`: `not_started`, `learning` or `practicing`
    only, and not while the skill is `assessed` or `proven`.
  - `add_skill_evidence(skills[], type, title, description, source_url, metadata, observed_at)`:
    `project` or `learning`, for 1 to 10 skills, at most 1000 records per user.
  - `update_skill_evidence(id, title, description, source_url, metadata)`: own project or
    learning evidence only. A learning record's roadmap reference cannot change.
  - `retract_skill_evidence(id)`: own project or learning evidence. The row is kept, with
    `retracted_at` set.
- Clients can never set `confidence_score`, the progress percentages, `assessed` or
  `proven`, a score, or assessment evidence.
- Another user's evidence id returns the same "not found" as an id that does not exist.
- A trigger updates progress from new evidence:
  - learning evidence moves `not_started` to `learning`;
  - project evidence moves `not_started` or `learning` to `practicing`;
  - assessment evidence moves anything below `assessed` to `assessed` and records the latest result.
  - The trigger never lowers `assessed` or `proven`.
- Deletion:
  - Deleting a profile deletes that user's progress and evidence.
  - A skill or an assessment that has history cannot be deleted.
  - Users never delete evidence.

## API

| Route                                   | Does                                                                 |
|-----------------------------------------|----------------------------------------------------------------------|
| `GET /api/skills/progress`              | own progress rows, plus the profile's claimed skills mapped to catalog ids |
| `PATCH /api/skills/progress`            | `{ skillId, status }`, calls `set_skill_progress_status`             |
| `GET /api/skills/evidence`              | own evidence, newest first; `?skillId=`, `?includeRetracted=1`       |
| `POST /api/skills/evidence`             | `{ type, skillIds, title, description?, sourceUrl?, metadata?, observedAt? }` |
| `PATCH /api/skills/evidence/[id]`       | edit `{ title?, description?, sourceUrl?, metadata? }` or `{ retracted: true }` |

- Unknown request fields are rejected with 400 rather than ignored. That includes
  `user_id`, `score`, `confidence` and `assessmentId`.
- Validation lives in `lib/skills/validation.ts` and mirrors the database rules; the
  database functions stay the authority.
- Database errors map to HTTP in `lib/skills/http.ts`:

| Database code | HTTP | Meaning                      |
|---------------|------|------------------------------|
| 22023         | 400  | invalid input                |
| P0002         | 404  | unknown skill or evidence    |
| 42501         | 403  | not allowed                  |
| 55000         | 409  | the row's state blocks the change |
| 54000         | 409  | evidence limit reached       |
| 23503         | 409  | no profile yet               |

## Applying

Apply in the Supabase SQL editor, in order:
1. Run the migration.
2. Run `supabase/tests/skill_progress_evidence_verification.sql`. It should end with
   "SKILL PROGRESS EVIDENCE VERIFICATION PASSED".
3. Run `supabase/tests/p0_rls_verification.sql`. It now reviews the two new tables, so it
   only passes once the migration is applied.
4. Run the three P1 verifications, which are unchanged.

The migration aborts and changes nothing if `skills` has names that differ only by case.

## Where later phases connect

- **Confidence.** A server-side function computes `confidence_score` and
  `confidence_updated_at` from non-retracted evidence, and may then set `proven`. Nothing
  sets confidence today.
- **Scored assessments.** A scored assessment should extend `assessments` (not a second
  system) and write assessment evidence through a server-only path that computes the score
  itself. No such writer exists yet, so no assessment evidence is created today.
- **Roadmap (Phase 2C backend, Phase 2D roadmap page).** Learning evidence comes only from
  completing a step of a trusted roadmap version. See the next section. The generic
  `POST /api/skills/evidence` refuses `type: "learning"` with 403.
- **Readiness.** Three places currently read claimed skills:
  - the gap analysis (`app/api/ai/career-analysis/route.ts`, from `profiles.skills` via
    `lib/ai/profile-input.ts`);
  - the readiness page (`app/readiness/page.tsx`, from the AI estimate);
  - job match (`app/api/jobs/route.ts`, `calculateMatch`: keyword match on
    `profiles.skills`).

  The flow should become evidence → confidence → requirements → readiness. Confidence
  should weight those inputs instead of replacing the claims outright.
- **AI interviews.** A new `ai_interview` type means widening the `evidence_type` check,
  the metadata rules and the functions in a new migration.

## Roadmap learning evidence (Phase 2C)

`learning_roadmaps` is the roadmap **display cache**. The user's own session writes it
(P1), so nothing in it is ever trusted as evidence.

Migration `20260928180000_roadmap_learning_evidence.sql` adds the evidence source:

- **`learning_roadmap_versions` / `learning_roadmap_version_steps`.**
  - One immutable, numbered version per generated roadmap.
  - Each step keeps its order, phase, skill text, reason, and the canonical skill id that
    `lib/skills/catalog.ts` resolved when the roadmap was generated. Unmatched and compound
    skills stay `NULL` and are never guessed.
  - Owners may SELECT their own rows.
  - No API role, `service_role` included, may INSERT, UPDATE, DELETE or TRUNCATE.
    Triggers also reject UPDATE, DELETE and TRUNCATE, except for the cascade when a profile
    is deleted.
- **`create_learning_roadmap_version(...)`.**
  - `service_role` only. It validates everything (steps numbered 1..N, sizes, skill ids)
    and writes the header and all steps atomically, under a per-user lock.
  - `/api/learning` calls it after each successful AI generation, through
    `lib/skills/roadmap-versions.ts`. That is the only module that reads `SUPABASE_SECRET_KEY`
    (server-only, never `NEXT_PUBLIC_`), and `/api/learning` is its only importer.
  - Without the key the roadmap works exactly as before, and roadmap evidence is
    unavailable.
- **`complete_roadmap_learning_step(version_id, step_order)`.**
  - `authenticated` only. It completes a step of the caller's **latest** version.
  - Skill, title, description and the metadata snapshot all come from the version rows.
    The function takes no skill, title or user argument.
  - Errors: an older version gives `SB409`; an unknown or foreign version or step gives
    `P0002`; an unmatched skill gives `SB422`.
  - It is idempotent through the partial unique index `skill_evidence_roadmap_completion_key`
    on (user, skill, version, step) over active roadmap rows. A retracted completion stays
    history, and completing again creates a new row.
  - Progress follows the existing trigger and is never lowered.

API: `GET /api/skills/roadmap` returns the latest version's steps with their completion
state, or `{ available: false }`. `POST /api/skills/roadmap { versionId, stepOrder }`
completes a step; any other field is rejected with 400. Neither method calls AI.

Roadmaps generated before this migration have no trusted version. Completion starts with
the next generated roadmap, and old cache rows are never copied into versions.

The roadmap page (`app/roadmap/page.tsx`, helpers in `lib/roadmap/tracking.ts`, components in
`components/roadmap/`) shows the display cache from `/api/learning` and takes every completion
state from `GET /api/skills/roadmap`. It offers "Mark learning complete" only when the shown
roadmap is the latest trusted version (same generation time, step count and step text), sends
`{ versionId, stepOrder }` and nothing else, and marks a step completed only after the server
confirms it. Unmatched steps say that tracking is unavailable; completing a step records
learning evidence and never claims the skill is verified.

Verification: run `supabase/tests/roadmap_learning_evidence_verification.sql`. The Phase 1
and P0 verifications also account for the new index and tables.
