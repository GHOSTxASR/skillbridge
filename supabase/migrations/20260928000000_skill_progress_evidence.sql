-- =============================================================================
-- Skill progress + evidence: data foundation (public.skill_progress, public.skill_evidence)
-- =============================================================================
-- What exists already, and what this migration deliberately does NOT duplicate:
--   * public.skills        the skill catalog (uuid id, name). It stays the only skill
--                          identity: both new tables reference skills(id). This migration
--                          adds a case-insensitive unique index on its names and adds the
--                          16 skills the assessment offers when they are missing.
--   * profiles.skills      what the user SAYS they know (self-reported names, written by the
--                          assessment and the account page). Untouched. A claimed skill is
--                          never turned into progress, evidence or confidence here.
--   * public.user_skills   the (unused, locked) catalog-keyed form of the same claims.
--                          Untouched, keeps that meaning.
--   * public.assessments   the assessment record (user_id, target_role). It holds no score:
--                          today's assessment is self-reported. Untouched except for a
--                          unique (id, user_id) key, so assessment evidence can require an
--                          assessment that belongs to the same user.
--   * public.skill_gaps / job_readiness   unused legacy tables; the live gap analysis is
--                          career_analyses and job match is computed in /api/jobs. Untouched.
--
-- The concepts are kept apart:
--   PROGRESS    skill_progress.status / learning_progress / practice_progress: what the
--               user has done. One row per (user, skill).
--   EVIDENCE    skill_evidence: what the user has shown. Many rows per (user, skill):
--               'assessment' (a measured result), 'project' (practical work, linked),
--               'learning' (completed learning, optionally a roadmap step).
--   CONFIDENCE  skill_progress.confidence_score: SkillBridge's evidence-based estimate.
--               NULL until a confidence model exists; nothing in this migration sets it.
--   READINESS   unchanged (career_analyses / job match); a later phase feeds it from
--               confidence.
--
-- Authority. Owners can SELECT their own rows (RLS, auth.uid() = user_id) and nothing
-- else directly: no INSERT / UPDATE / DELETE privilege on either table. Every write goes
-- through a SECURITY DEFINER function below that validates its input and always acts on
-- auth.uid(); none takes a user id. So a client can never:
--   * set confidence_score, learning/practice progress, or the evidence-derived
--     'assessed' / 'proven' statuses;
--   * create 'assessment' evidence or a score (only a server-side assessment result may,
--     written by a privileged role; no such writer exists yet, see below);
--   * write, read, edit or retract another user's rows (unknown and foreign evidence ids
--     get the same "not found").
-- Functions for authenticated users:
--   set_skill_progress_status(skill, status)   not_started | learning | practicing, and
--                                              only while the skill is not assessed/proven
--   add_skill_evidence(...)                    'project' or 'learning' for 1-10 skills
--   update_skill_evidence(id, ...)             edit own project/learning evidence
--   retract_skill_evidence(id)                 withdraw own project/learning evidence
--
-- Evidence lifecycle. Evidence is history: rows are never deleted by users. Project and
-- learning evidence can be retracted (retracted_at is set, the row stays, and a future
-- confidence model must ignore it). Assessment evidence cannot be edited or retracted.
-- A trigger keeps skill_progress in step with new evidence: it creates the progress row
-- if needed, records first/last activity, moves not_started -> learning (learning
-- evidence), not_started/learning -> practicing (project evidence), anything below
-- assessed -> assessed (assessment evidence) with the latest assessment, and never lowers
-- 'assessed' or 'proven'. 'proven' is reserved for the confidence model and requires a
-- confidence_score.
--
-- Deletion behaviour:
--   * profile deleted     -> its progress and evidence are deleted (ON DELETE CASCADE, like
--                            every other per-user table); its assessments cascade too.
--   * skill deleted       -> refused while any progress or evidence references it, so
--                            retiring a catalog skill cannot erase anyone's history.
--   * assessment deleted  -> refused while evidence references it (checked at the end of
--                            the statement, so deleting the whole profile still works).
--
-- Limits: title <= 200 chars, description <= 2000, URLs <= 2048 and http(s) only, with no
-- user:password@ part and no token/secret/password/key/signature query parameters;
-- metadata is a JSON object <= 4096 bytes with per-type keys; score 0-100; at most 1000
-- evidence rows per user. A future type such as 'ai_interview' is added by widening the
-- evidence_type check and the functions in a new migration.
--
-- Safe to re-run. Aborts, changing nothing, if a precondition or the final self-check
-- fails. service_role and postgres privileges are not touched.
-- =============================================================================

begin;

-- 1. Preconditions ------------------------------------------------------------
do $$
declare dupes text;
begin
  if not exists (
    select 1
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.conrelid = to_regclass('public.profiles') and con.contype = 'p'
      and array_length(con.conkey, 1) = 1 and att.attname = 'id' and att.atttypid = 'uuid'::regtype
  ) then
    raise exception 'Skill progress migration aborted, nothing changed: public.profiles with a uuid primary key "id" is required';
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.conrelid = to_regclass('public.skills') and con.contype = 'p'
      and array_length(con.conkey, 1) = 1 and att.attname = 'id' and att.atttypid = 'uuid'::regtype
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = to_regclass('public.skills') and attname = 'name'
      and atttypid = 'text'::regtype and not attisdropped
  ) then
    raise exception 'Skill progress migration aborted, nothing changed: public.skills with a uuid primary key "id" and a text "name" is required';
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.conrelid = to_regclass('public.assessments') and con.contype = 'p'
      and array_length(con.conkey, 1) = 1 and att.attname = 'id' and att.atttypid = 'uuid'::regtype
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = to_regclass('public.assessments') and attname = 'user_id'
      and atttypid = 'uuid'::regtype and not attisdropped
  ) then
    raise exception 'Skill progress migration aborted, nothing changed: public.assessments with a uuid primary key "id" and a uuid "user_id" is required';
  end if;

  if to_regclass('public.learning_roadmaps') is null then
    raise exception 'Skill progress migration aborted, nothing changed: public.learning_roadmaps (P1) is required';
  end if;

  if to_regprocedure('auth.uid()') is null
     or (select count(*) from pg_roles where rolname in ('anon', 'authenticated')) <> 2 then
    raise exception 'Skill progress migration aborted, nothing changed: auth.uid() and the anon/authenticated roles are required';
  end if;

  -- Skill names become unique ignoring case; existing duplicates must be resolved first.
  select string_agg(format('%s (x%s)', n, c), ', ') into dupes
  from (select lower(name) as n, count(*) as c from public.skills group by lower(name) having count(*) > 1) d;
  if dupes is not null then
    raise exception 'Skill progress migration aborted, nothing changed: public.skills has names that differ only by case: %. Merge them first.', dupes;
  end if;
end $$;

-- 2. Catalog: one skill per name, and the skills the assessment offers ------------
create unique index if not exists skills_name_lower_key on public.skills (lower(name));

do $$
declare
  has_category boolean := exists (
    select 1 from pg_attribute
    where attrelid = 'public.skills'::regclass and attname = 'category' and not attisdropped);
begin
  create temporary table skill_seed (name text, category text) on commit drop;
  -- The assessment's skill picker (app/assessment/page.tsx, SKILL_GROUPS).
  insert into skill_seed (name, category) values
    ('Python', 'Languages'), ('JavaScript', 'Languages'), ('TypeScript', 'Languages'),
    ('Java', 'Languages'), ('C++', 'Languages'),
    ('React', 'Web & APIs'), ('Node.js', 'Web & APIs'), ('REST APIs', 'Web & APIs'),
    ('SQL', 'Data'), ('PostgreSQL', 'Data'), ('MongoDB', 'Data'),
    ('DSA', 'Foundations & tools'), ('Git', 'Foundations & tools'), ('Linux', 'Foundations & tools'),
    ('Docker', 'Cloud & DevOps'), ('AWS', 'Cloud & DevOps');

  if has_category then
    insert into public.skills (id, name, category)
    select gen_random_uuid(), s.name, s.category from skill_seed s
    where not exists (select 1 from public.skills k where lower(k.name) = lower(s.name));
  else
    insert into public.skills (id, name)
    select gen_random_uuid(), s.name from skill_seed s
    where not exists (select 1 from public.skills k where lower(k.name) = lower(s.name));
  end if;
end $$;

-- 3. Assessments: a key that lets evidence require the same owner ---------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assessments'::regclass and conname = 'assessments_id_user_id_key'
  ) then
    alter table public.assessments add constraint assessments_id_user_id_key unique (id, user_id);
  end if;
end $$;

-- 4. URL rule shared by the checks and the functions --------------------------------
-- http(s) only; host of letters, digits, dots and hyphens (so no user:password@); no
-- credential-looking query parameters; at most 2048 characters. Links are stored for
-- people to open, never fetched by SkillBridge.
create or replace function public.skill_evidence_url_ok(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
     and char_length(p_url) <= 2048
     and p_url ~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
     and p_url !~* '[?&#;](access_?token|id_?token|refresh_?token|token|secret|client_?secret|password|passwd|pwd|api_?key|apikey|key|sig|signature|auth)='
$$;

revoke all on function public.skill_evidence_url_ok(text) from public, anon, authenticated;
grant execute on function public.skill_evidence_url_ok(text) to service_role;

-- 5. Evidence ---------------------------------------------------------------------
create table if not exists public.skill_evidence (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references public.profiles(id) on delete cascade,
  skill_id      uuid        not null references public.skills(id),
  evidence_type text        not null,
  title         text        not null,
  description   text,
  source_url    text,
  score         numeric(5,2),
  assessment_id uuid,
  group_id      uuid,
  metadata      jsonb       not null default '{}'::jsonb,
  observed_at   timestamptz not null default now(),
  retracted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint skill_evidence_type
    check (evidence_type in ('assessment', 'project', 'learning')),
  constraint skill_evidence_title
    check (char_length(btrim(title)) between 1 and 200),
  constraint skill_evidence_description
    check (description is null or char_length(description) <= 2000),
  constraint skill_evidence_source_url
    check (source_url is null or public.skill_evidence_url_ok(source_url)),
  constraint skill_evidence_score
    check (score is null or score between 0 and 100),
  -- A score exists only on assessment evidence, which must name its assessment.
  constraint skill_evidence_assessment_fields
    check ((evidence_type = 'assessment' and assessment_id is not null and score is not null)
           or (evidence_type <> 'assessment' and assessment_id is null and score is null)),
  constraint skill_evidence_metadata
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096),
  constraint skill_evidence_observed_at
    check (observed_at >= timestamptz '2000-01-01 00:00:00+00'),
  constraint skill_evidence_retraction
    check (retracted_at is null or evidence_type <> 'assessment'),
  constraint skill_evidence_id_user_skill_key unique (id, user_id, skill_id),
  -- The assessment must belong to the same user (MATCH SIMPLE: unchecked when NULL).
  constraint skill_evidence_assessment_owner_fkey
    foreign key (assessment_id, user_id) references public.assessments (id, user_id)
);

create index if not exists skill_evidence_user_skill_idx
  on public.skill_evidence (user_id, skill_id, observed_at desc);
create index if not exists skill_evidence_skill_idx
  on public.skill_evidence (skill_id);
create index if not exists skill_evidence_group_idx
  on public.skill_evidence (user_id, group_id) where group_id is not null;
create index if not exists skill_evidence_assessment_idx
  on public.skill_evidence (assessment_id) where assessment_id is not null;

-- 6. Progress ---------------------------------------------------------------------
create table if not exists public.skill_progress (
  user_id                       uuid        not null references public.profiles(id) on delete cascade,
  skill_id                      uuid        not null references public.skills(id),
  status                        text        not null default 'not_started',
  confidence_score              smallint,
  confidence_updated_at         timestamptz,
  learning_progress             smallint,
  practice_progress             smallint,
  latest_assessment_evidence_id uuid,
  last_assessed_at              timestamptz,
  first_observed_at             timestamptz not null default now(),
  last_activity_at              timestamptz not null default now(),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint skill_progress_pkey primary key (user_id, skill_id),
  constraint skill_progress_status
    check (status in ('not_started', 'learning', 'practicing', 'assessed', 'proven')),
  constraint skill_progress_confidence
    check ((confidence_score is null) = (confidence_updated_at is null)
           and (confidence_score is null or confidence_score between 0 and 100)),
  constraint skill_progress_progress_range
    check ((learning_progress is null or learning_progress between 0 and 100)
           and (practice_progress is null or practice_progress between 0 and 100)),
  constraint skill_progress_latest_assessment
    check ((latest_assessment_evidence_id is null) = (last_assessed_at is null)),
  -- Evidence-derived statuses need their evidence: assessed needs an assessment, proven a
  -- confidence estimate.
  constraint skill_progress_status_basis
    check ((status <> 'assessed' or last_assessed_at is not null)
           and (status <> 'proven' or confidence_score is not null)),
  -- The latest assessment is the same user's evidence for the same skill.
  constraint skill_progress_latest_assessment_fkey
    foreign key (latest_assessment_evidence_id, user_id, skill_id)
    references public.skill_evidence (id, user_id, skill_id)
);

create index if not exists skill_progress_skill_idx on public.skill_progress (skill_id);
create index if not exists skill_progress_latest_assessment_idx
  on public.skill_progress (latest_assessment_evidence_id) where latest_assessment_evidence_id is not null;

-- 7. RLS and minimum privileges ---------------------------------------------------
alter table public.skill_evidence enable row level security;
alter table public.skill_progress enable row level security;

-- New public tables inherit Supabase's default grants (ALL to anon and authenticated).
revoke all on table public.skill_evidence, public.skill_progress from anon, authenticated, public;
grant select on table public.skill_evidence, public.skill_progress to authenticated;

do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('skill_evidence', 'skill_progress')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy skill_evidence_select_own on public.skill_evidence
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id);

create policy skill_progress_select_own on public.skill_progress
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id);

-- 8. Progress follows new evidence --------------------------------------------------
create or replace function public.skill_evidence_apply_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assessment boolean := new.evidence_type = 'assessment';
begin
  insert into public.skill_progress as p
    (user_id, skill_id, status, first_observed_at, last_activity_at,
     latest_assessment_evidence_id, last_assessed_at)
  values
    (new.user_id, new.skill_id,
     case new.evidence_type when 'learning' then 'learning'
                            when 'project'  then 'practicing'
                            else 'assessed' end,
     least(new.observed_at, now()), now(),
     case when v_assessment then new.id end,
     case when v_assessment then new.observed_at end)
  on conflict (user_id, skill_id) do update
    set status = case
          when p.status in ('assessed', 'proven') then p.status
          when v_assessment then 'assessed'
          when new.evidence_type = 'project' then 'practicing'
          when new.evidence_type = 'learning' and p.status = 'not_started' then 'learning'
          else p.status
        end,
        first_observed_at = least(p.first_observed_at, new.observed_at),
        last_activity_at = now(),
        latest_assessment_evidence_id = case
          when v_assessment and (p.last_assessed_at is null or new.observed_at >= p.last_assessed_at)
            then new.id else p.latest_assessment_evidence_id end,
        last_assessed_at = case
          when v_assessment and (p.last_assessed_at is null or new.observed_at >= p.last_assessed_at)
            then new.observed_at else p.last_assessed_at end,
        updated_at = now();
  return null;
end;
$$;

revoke all on function public.skill_evidence_apply_progress() from public, anon, authenticated;

drop trigger if exists skill_evidence_apply_progress on public.skill_evidence;
create trigger skill_evidence_apply_progress
  after insert on public.skill_evidence
  for each row execute function public.skill_evidence_apply_progress();

-- 9. Metadata rule shared by add/update -------------------------------------------
-- project:  { demo_url }                                        (all optional)
-- learning: { roadmap_input_hash, roadmap_step, roadmap_skill } (all three or none); the
--           step must exist in the user's current learning roadmap when recorded. The
--           roadmap row is regenerated when the profile changes, so these fields are a
--           snapshot of the step, not a foreign key.
create or replace function public.skill_evidence_check_metadata(
  p_user uuid, p_type text, p_metadata jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_meta    jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_allowed text[];
  v_bad     text;
  v_step    numeric;
begin
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception 'metadata must be a JSON object' using errcode = '22023';
  end if;
  if octet_length(v_meta::text) > 4096 then
    raise exception 'metadata is larger than 4096 bytes' using errcode = '22023';
  end if;

  v_allowed := case p_type
    when 'project'  then array['demo_url']
    when 'learning' then array['roadmap_input_hash', 'roadmap_step', 'roadmap_skill']
    else array[]::text[] end;

  select string_agg(k, ', ' order by k) into v_bad
  from jsonb_object_keys(v_meta) k where k <> all (v_allowed);
  if v_bad is not null then
    raise exception 'metadata field(s) not allowed for % evidence: %', p_type, v_bad using errcode = '22023';
  end if;

  if p_type = 'project' and v_meta ? 'demo_url'
     and (jsonb_typeof(v_meta -> 'demo_url') <> 'string'
          or not public.skill_evidence_url_ok(v_meta ->> 'demo_url')) then
    raise exception 'metadata.demo_url must be an http(s) link without credentials' using errcode = '22023';
  end if;

  if p_type = 'learning'
     and (v_meta ? 'roadmap_input_hash' or v_meta ? 'roadmap_step' or v_meta ? 'roadmap_skill') then
    if not (v_meta ? 'roadmap_input_hash' and v_meta ? 'roadmap_step' and v_meta ? 'roadmap_skill')
       or jsonb_typeof(v_meta -> 'roadmap_input_hash') <> 'string'
       or jsonb_typeof(v_meta -> 'roadmap_step') <> 'number'
       or jsonb_typeof(v_meta -> 'roadmap_skill') <> 'string'
       or char_length(v_meta ->> 'roadmap_input_hash') not between 1 and 128
       or char_length(v_meta ->> 'roadmap_skill') not between 1 and 80 then
      raise exception 'a roadmap reference needs roadmap_input_hash (text), roadmap_step (number) and roadmap_skill (text)'
        using errcode = '22023';
    end if;

    v_step := (v_meta ->> 'roadmap_step')::numeric;
    if v_step <> trunc(v_step) or v_step < 1 or v_step > 50 then
      raise exception 'metadata.roadmap_step must be a whole number from 1 to 50' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.learning_roadmaps r
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(r.roadmap) = 'array' then r.roadmap else '[]'::jsonb end) e
      where r.user_id = p_user
        and r.input_hash = v_meta ->> 'roadmap_input_hash'
        and jsonb_typeof(e) = 'object'
        and e ->> 'order' = (v_step::integer)::text
        and lower(e ->> 'skill') = lower(v_meta ->> 'roadmap_skill')
    ) then
      raise exception 'that roadmap step is not in your current learning roadmap' using errcode = '22023';
    end if;
  end if;

  return v_meta;
end;
$$;

revoke all on function public.skill_evidence_check_metadata(uuid, text, jsonb) from public, anon, authenticated;

-- 10. Owner write functions ----------------------------------------------------------
-- Error codes the API maps to HTTP: 42501 not signed in / not allowed, 22023 invalid
-- input, P0002 unknown skill or evidence (also for another user's evidence), 55000 the
-- row is in a state that forbids the change, 54000 evidence limit reached, 23503 no
-- profile yet.

create or replace function public.set_skill_progress_status(p_skill_id uuid, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.skill_progress%rowtype;
begin
  if v_user is null then
    raise exception 'set_skill_progress_status: not authenticated' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('not_started', 'learning', 'practicing') then
    raise exception 'status can be set to not_started, learning or practicing; assessed and proven come from evidence'
      using errcode = '22023';
  end if;
  if p_skill_id is null or not exists (select 1 from public.skills where id = p_skill_id) then
    raise exception 'unknown skill' using errcode = 'P0002';
  end if;

  insert into public.skill_progress as p (user_id, skill_id, status)
  values (v_user, p_skill_id, p_status)
  on conflict (user_id, skill_id) do update
    set status = excluded.status, last_activity_at = now(), updated_at = now()
    where p.status not in ('assessed', 'proven')
  returning * into v_row;

  if v_row.user_id is null then
    raise exception 'this skill''s status comes from assessment evidence and cannot be set by hand'
      using errcode = '55000';
  end if;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.add_skill_evidence(
  p_skill_ids     uuid[],
  p_evidence_type text,
  p_title         text,
  p_description   text default null,
  p_source_url    text default null,
  p_metadata      jsonb default null,
  p_observed_at   timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user        uuid := auth.uid();
  v_title       text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_url         text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_observed    timestamptz := coalesce(p_observed_at, now());
  v_meta        jsonb;
  v_group       uuid := gen_random_uuid();
  v_count       integer;
  v_rows        jsonb;
begin
  if v_user is null then
    raise exception 'add_skill_evidence: not authenticated' using errcode = '42501';
  end if;
  if p_evidence_type = 'assessment' then
    raise exception 'assessment evidence is recorded by SkillBridge from an assessment result, not submitted'
      using errcode = '42501';
  end if;
  if p_evidence_type is null or p_evidence_type not in ('project', 'learning') then
    raise exception 'evidence type must be project or learning' using errcode = '22023';
  end if;

  if p_skill_ids is null or array_ndims(p_skill_ids) is distinct from 1
     or cardinality(p_skill_ids) not between 1 and 10
     or array_position(p_skill_ids, null) is not null
     or (select count(distinct s) from unnest(p_skill_ids) s) <> cardinality(p_skill_ids) then
    raise exception 'give 1 to 10 different skill ids' using errcode = '22023';
  end if;
  if (select count(*) from public.skills where id = any (p_skill_ids)) <> cardinality(p_skill_ids) then
    raise exception 'unknown skill' using errcode = 'P0002';
  end if;

  if char_length(v_title) not between 1 and 200 or v_title ~ '[[:cntrl:]]' then
    raise exception 'title must be 1 to 200 characters on one line' using errcode = '22023';
  end if;
  if v_description is not null
     and (char_length(v_description) > 2000 or v_description ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]') then
    raise exception 'description must be at most 2000 characters' using errcode = '22023';
  end if;
  if v_url is not null and not public.skill_evidence_url_ok(v_url) then
    raise exception 'source_url must be an http(s) link without credentials' using errcode = '22023';
  end if;
  if v_observed < timestamptz '2000-01-01 00:00:00+00' or v_observed > now() + interval '5 minutes' then
    raise exception 'observed_at must be a past date' using errcode = '22023';
  end if;

  v_meta := public.skill_evidence_check_metadata(v_user, p_evidence_type, p_metadata);

  select count(*) into v_count from public.skill_evidence where user_id = v_user;
  if v_count + cardinality(p_skill_ids) > 1000 then
    raise exception 'evidence limit reached (1000 records)' using errcode = '54000';
  end if;

  with inserted as (
    insert into public.skill_evidence
      (user_id, skill_id, evidence_type, title, description, source_url, group_id, metadata, observed_at)
    select v_user, s, p_evidence_type, v_title, v_description, v_url, v_group, v_meta, v_observed
    from unnest(p_skill_ids) s
    returning *
  )
  select jsonb_agg(to_jsonb(i) order by i.skill_id) into v_rows from inserted i;

  return jsonb_build_object('group_id', v_group, 'evidence', v_rows);
end;
$$;

create or replace function public.update_skill_evidence(
  p_evidence_id uuid,
  p_title       text,
  p_description text default null,
  p_source_url  text default null,
  p_metadata    jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user        uuid := auth.uid();
  v_row         public.skill_evidence%rowtype;
  v_title       text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_url         text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_meta        jsonb;
begin
  if v_user is null then
    raise exception 'update_skill_evidence: not authenticated' using errcode = '42501';
  end if;

  select * into v_row from public.skill_evidence
  where id = p_evidence_id and user_id = v_user
  for update;
  if not found then
    raise exception 'evidence not found' using errcode = 'P0002';
  end if;
  if v_row.evidence_type = 'assessment' then
    raise exception 'assessment evidence cannot be edited' using errcode = '42501';
  end if;
  if v_row.retracted_at is not null then
    raise exception 'retracted evidence cannot be edited' using errcode = '55000';
  end if;

  if char_length(v_title) not between 1 and 200 or v_title ~ '[[:cntrl:]]' then
    raise exception 'title must be 1 to 200 characters on one line' using errcode = '22023';
  end if;
  if v_description is not null
     and (char_length(v_description) > 2000 or v_description ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]') then
    raise exception 'description must be at most 2000 characters' using errcode = '22023';
  end if;
  if v_url is not null and not public.skill_evidence_url_ok(v_url) then
    raise exception 'source_url must be an http(s) link without credentials' using errcode = '22023';
  end if;

  -- A learning record's roadmap reference is a snapshot of when it was recorded.
  if v_row.evidence_type = 'learning' then
    if p_metadata is not null and p_metadata is distinct from v_row.metadata then
      raise exception 'the roadmap reference of learning evidence cannot be changed' using errcode = '22023';
    end if;
    v_meta := v_row.metadata;
  else
    v_meta := public.skill_evidence_check_metadata(v_user, v_row.evidence_type, p_metadata);
  end if;

  update public.skill_evidence
     set title = v_title, description = v_description, source_url = v_url,
         metadata = v_meta, updated_at = now()
   where id = v_row.id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.retract_skill_evidence(p_evidence_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.skill_evidence%rowtype;
begin
  if v_user is null then
    raise exception 'retract_skill_evidence: not authenticated' using errcode = '42501';
  end if;

  select * into v_row from public.skill_evidence
  where id = p_evidence_id and user_id = v_user
  for update;
  if not found then
    raise exception 'evidence not found' using errcode = 'P0002';
  end if;
  if v_row.evidence_type = 'assessment' then
    raise exception 'assessment evidence cannot be retracted' using errcode = '42501';
  end if;

  if v_row.retracted_at is null then
    update public.skill_evidence
       set retracted_at = now(), updated_at = now()
     where id = v_row.id
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

-- Functions are executable by PUBLIC by default, and Supabase also grants new public
-- functions to anon: only signed-in users may call these.
revoke all on function public.set_skill_progress_status(uuid, text) from public, anon, authenticated;
revoke all on function public.add_skill_evidence(uuid[], text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.update_skill_evidence(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.retract_skill_evidence(uuid) from public, anon, authenticated;
grant execute on function public.set_skill_progress_status(uuid, text) to authenticated;
grant execute on function public.add_skill_evidence(uuid[], text, text, text, text, jsonb, timestamptz) to authenticated;
grant execute on function public.update_skill_evidence(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.retract_skill_evidence(uuid) to authenticated;

-- 11. Self-check before commit: any mismatch aborts and rolls everything back ----
do $$
declare
  bad text;
  owner_fns constant text[] := array[
    'public.set_skill_progress_status(uuid,text)',
    'public.add_skill_evidence(uuid[],text,text,text,text,jsonb,timestamp with time zone)',
    'public.update_skill_evidence(uuid,text,text,text,jsonb)',
    'public.retract_skill_evidence(uuid)'];
  internal_fns constant text[] := array[
    'public.skill_evidence_url_ok(text)',
    'public.skill_evidence_apply_progress()',
    'public.skill_evidence_check_metadata(uuid,text,jsonb)'];
  f text;
begin
  with expected(tbl, col, typ, not_null) as (
    values ('skill_evidence', 'id', 'uuid', true), ('skill_evidence', 'user_id', 'uuid', true),
           ('skill_evidence', 'skill_id', 'uuid', true), ('skill_evidence', 'evidence_type', 'text', true),
           ('skill_evidence', 'title', 'text', true), ('skill_evidence', 'description', 'text', false),
           ('skill_evidence', 'source_url', 'text', false), ('skill_evidence', 'score', 'numeric(5,2)', false),
           ('skill_evidence', 'assessment_id', 'uuid', false), ('skill_evidence', 'group_id', 'uuid', false),
           ('skill_evidence', 'metadata', 'jsonb', true),
           ('skill_evidence', 'observed_at', 'timestamp with time zone', true),
           ('skill_evidence', 'retracted_at', 'timestamp with time zone', false),
           ('skill_evidence', 'created_at', 'timestamp with time zone', true),
           ('skill_evidence', 'updated_at', 'timestamp with time zone', true),
           ('skill_progress', 'user_id', 'uuid', true), ('skill_progress', 'skill_id', 'uuid', true),
           ('skill_progress', 'status', 'text', true), ('skill_progress', 'confidence_score', 'smallint', false),
           ('skill_progress', 'confidence_updated_at', 'timestamp with time zone', false),
           ('skill_progress', 'learning_progress', 'smallint', false),
           ('skill_progress', 'practice_progress', 'smallint', false),
           ('skill_progress', 'latest_assessment_evidence_id', 'uuid', false),
           ('skill_progress', 'last_assessed_at', 'timestamp with time zone', false),
           ('skill_progress', 'first_observed_at', 'timestamp with time zone', true),
           ('skill_progress', 'last_activity_at', 'timestamp with time zone', true),
           ('skill_progress', 'created_at', 'timestamp with time zone', true),
           ('skill_progress', 'updated_at', 'timestamp with time zone', true)
  ),
  actual as (
    select c.relname::text as tbl, a.attname::text as col,
           format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as not_null
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.oid in ('public.skill_evidence'::regclass, 'public.skill_progress'::regclass)
      and a.attnum > 0 and not a.attisdropped
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || tbl || '.' || col || ' ' || typ as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || tbl || '.' || col || ' ' || typ from (select * from expected except select * from actual) y)
  ) z;
  if bad is not null then
    raise exception 'Skill progress self-check failed: columns differ from the intended tables: %', bad;
  end if;

  if (select count(*) from pg_constraint
      where conrelid = 'public.skill_evidence'::regclass and contype = 'c'
        and conname in ('skill_evidence_type', 'skill_evidence_title', 'skill_evidence_description',
                        'skill_evidence_source_url', 'skill_evidence_score', 'skill_evidence_assessment_fields',
                        'skill_evidence_metadata', 'skill_evidence_observed_at', 'skill_evidence_retraction')) <> 9
     or (select count(*) from pg_constraint
         where conrelid = 'public.skill_progress'::regclass and contype = 'c'
           and conname in ('skill_progress_status', 'skill_progress_confidence', 'skill_progress_progress_range',
                           'skill_progress_latest_assessment', 'skill_progress_status_basis')) <> 5 then
    raise exception 'Skill progress self-check failed: check constraints are missing';
  end if;

  -- Foreign keys: user -> profiles CASCADE; skill -> skills and the assessment/evidence
  -- links refuse deletion (NO ACTION).
  with expected(tbl, ref, del) as (
    values ('skill_evidence', 'profiles', 'c'), ('skill_evidence', 'skills', 'a'),
           ('skill_evidence', 'assessments', 'a'),
           ('skill_progress', 'profiles', 'c'), ('skill_progress', 'skills', 'a'),
           ('skill_progress', 'skill_evidence', 'a')
  ),
  actual as (
    select src.relname::text as tbl, dst.relname::text as ref, con.confdeltype::text as del
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_class dst on dst.oid = con.confrelid
    where con.conrelid in ('public.skill_evidence'::regclass, 'public.skill_progress'::regclass) and con.contype = 'f'
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || tbl || ' -> ' || ref || ' ' || del as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || tbl || ' -> ' || ref || ' ' || del from (select * from expected except select * from actual) y)
  ) z;
  if bad is not null then
    raise exception 'Skill progress self-check failed: foreign keys differ from the intended model: %', bad;
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'skills_name_lower_key')
     or not exists (select 1 from pg_constraint
                    where conrelid = 'public.assessments'::regclass and conname = 'assessments_id_user_id_key') then
    raise exception 'Skill progress self-check failed: skills name index or assessments (id, user_id) key missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.skill_evidence'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.skill_progress'::regclass) then
    raise exception 'Skill progress self-check failed: RLS is not enabled';
  end if;

  with expected(tbl, policyname, cmd, roles) as (
    values ('skill_evidence', 'skill_evidence_select_own', 'SELECT', 'authenticated'),
           ('skill_progress', 'skill_progress_select_own', 'SELECT', 'authenticated')
  ),
  actual as (
    select tablename::text as tbl, policyname::text as policyname, cmd::text as cmd,
           (select string_agg(r::text, ',' order by r::text) from unnest(roles) r) as roles
    from pg_policies
    where schemaname = 'public' and tablename in ('skill_evidence', 'skill_progress') and permissive = 'PERMISSIVE'
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || tbl || '.' || policyname || ' ' || cmd as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || tbl || '.' || policyname from (select * from expected except select * from actual) y)
    union all
    (select 'restrictive ' || tablename || '.' || policyname from pg_policies
     where schemaname = 'public' and tablename in ('skill_evidence', 'skill_progress') and permissive <> 'PERMISSIVE')
  ) z;
  if bad is not null then
    raise exception 'Skill progress self-check failed: policy set differs from the intended model: %', bad;
  end if;

  with expected(tbl, grantee, priv) as (
    values ('skill_evidence', 'authenticated', 'SELECT'), ('skill_progress', 'authenticated', 'SELECT')
  ),
  actual as (
    select c.relname::text as tbl,
           case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as grantee,
           a.privilege_type::text as priv
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    left join pg_roles r on r.oid = a.grantee
    where c.oid in ('public.skill_evidence'::regclass, 'public.skill_progress'::regclass)
      and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || grantee || ' ' || priv || ' on ' || tbl as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || grantee || ' ' || priv || ' on ' || tbl from (select * from expected except select * from actual) y)
  ) z;
  if bad is not null
     or has_table_privilege('anon', 'public.skill_evidence', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('anon', 'public.skill_progress', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.skill_evidence', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.skill_progress', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception 'Skill progress self-check failed: privileges differ from the intended model: %', coalesce(bad, 'inherited privilege');
  end if;

  foreach f in array owner_fns loop
    if not exists (select 1 from pg_proc where oid = f::regprocedure and prosecdef
                   and provolatile = 'v' and proconfig @> array['search_path=""']) then
      raise exception 'Skill progress self-check failed: % must be a volatile SECURITY DEFINER function with an empty search_path', f;
    end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE')
       or has_function_privilege('anon', f, 'EXECUTE')
       or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                  where p.oid = f::regprocedure and a.grantee = 0) then
      raise exception 'Skill progress self-check failed: % must be executable by authenticated only', f;
    end if;
  end loop;

  foreach f in array internal_fns loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                  where p.oid = f::regprocedure and a.grantee = 0) then
      raise exception 'Skill progress self-check failed: internal function % must not be executable by anon, authenticated or PUBLIC', f;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger
                 where tgrelid = 'public.skill_evidence'::regclass
                   and tgname = 'skill_evidence_apply_progress' and not tgisinternal) then
    raise exception 'Skill progress self-check failed: the progress trigger is missing';
  end if;

  raise notice 'Skill progress self-check passed: 2 tables, constraints, foreign keys, RLS with owner SELECT only, 4 owner functions, trigger, catalog index';
end $$;

commit;
