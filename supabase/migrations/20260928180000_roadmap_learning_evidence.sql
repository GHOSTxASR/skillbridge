-- =============================================================================
-- Trusted learning-roadmap versions + roadmap step completion -> learning evidence
-- =============================================================================
-- Problem this solves: public.learning_roadmaps is written with the user's own session
-- (P1: owner INSERT / UPDATE), so a user can rewrite every column of it. It stays what it
-- is, the display cache, and is NEVER used as evidence provenance.
--
-- New, immutable evidence source:
--   public.learning_roadmap_versions        one row per generated roadmap (per user, numbered)
--   public.learning_roadmap_version_steps   its steps: order, phase, skill text as generated,
--                                           the canonical skill id resolved when generated
--                                           (NULL when the catalog had no match), reason
--   Written ONLY by create_learning_roadmap_version(), which only service_role may run (the
--   app calls it from the server with the Supabase secret key, right after an AI roadmap is
--   generated). Owners may SELECT their own rows. Nobody may UPDATE, DELETE or TRUNCATE:
--   privileges are withheld from every API role (service_role included) and triggers reject
--   those operations for everyone else too. The one exception is the ON DELETE CASCADE when
--   a profile is deleted (a row may be deleted only once its parent row is gone).
--
-- complete_roadmap_learning_step(p_version_id, p_step_order)  (authenticated)
--   Records learning evidence for one step of the caller's LATEST version. Skill, title,
--   description and the metadata snapshot come only from the version rows; the function
--   takes no skill, title or user argument. Older version -> SB409; unknown or foreign
--   version / step -> P0002 (identical, so ids cannot be probed); unmatched skill -> SB422.
--   Idempotent: one ACTIVE completion per (user, skill, version, step), enforced by the
--   unique index below with INSERT ... ON CONFLICT DO NOTHING. Retracted completions stay
--   history and do not block a new one. Progress follows through the existing trigger and
--   is never lowered; confidence, scores and percentages are never set.
--
-- Runs once: aborts, changing nothing, if any object already exists, a precondition fails
-- or the final self-check fails.
-- =============================================================================

begin;

-- 1. Preconditions ------------------------------------------------------------
do $$
begin
  if to_regclass('public.profiles') is null or to_regclass('public.skills') is null
     or to_regclass('public.skill_evidence') is null or to_regclass('public.skill_progress') is null then
    raise exception 'Roadmap learning evidence migration aborted, nothing changed: apply the skill progress/evidence migration first';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'skill_evidence_apply_progress'
                 and tgrelid = 'public.skill_evidence'::regclass) then
    raise exception 'Roadmap learning evidence migration aborted, nothing changed: the skill progress trigger is missing';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'Roadmap learning evidence migration aborted, nothing changed: the Supabase API roles are missing';
  end if;
  if to_regclass('public.learning_roadmap_versions') is not null
     or to_regclass('public.learning_roadmap_version_steps') is not null
     or to_regclass('public.skill_evidence_roadmap_completion_key') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                and proname in ('create_learning_roadmap_version', 'complete_roadmap_learning_step',
                                'learning_roadmap_versions_immutable')) then
    raise exception 'Roadmap learning evidence migration aborted, nothing changed: it has already been applied (it runs once)';
  end if;
end $$;

-- 2. Immutable version tables ------------------------------------------------------
create table public.learning_roadmap_versions (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  version_number  integer     not null check (version_number >= 1),
  input_hash      text        not null check (char_length(input_hash) between 1 and 128),
  model           text        not null check (char_length(model) between 1 and 200),
  prompt_version  text        not null check (char_length(prompt_version) between 1 and 50),
  generated_at    timestamptz not null,
  step_count      smallint    not null check (step_count between 1 and 50),
  created_at      timestamptz not null default now(),
  constraint learning_roadmap_versions_user_number_key unique (user_id, version_number),
  constraint learning_roadmap_versions_id_user_key unique (id, user_id)
);

create table public.learning_roadmap_version_steps (
  version_id  uuid     not null,
  user_id     uuid     not null,
  step_order  smallint not null check (step_order between 1 and 50),
  phase       text     check (phase is null or (char_length(phase) between 1 and 200 and btrim(phase) <> '')),
  skill_text  text     not null check (char_length(skill_text) between 1 and 200 and btrim(skill_text) <> ''),
  skill_id    uuid     references public.skills(id),
  reason      text     check (reason is null or char_length(reason) between 1 and 2000),
  constraint learning_roadmap_version_steps_pkey primary key (version_id, step_order),
  constraint learning_roadmap_version_steps_version_fkey
    foreign key (version_id, user_id) references public.learning_roadmap_versions (id, user_id) on delete cascade
);

create index learning_roadmap_version_steps_skill_idx
  on public.learning_roadmap_version_steps (skill_id) where skill_id is not null;

-- 3. RLS and privileges: owners read their own rows; no API role writes -----------------
alter table public.learning_roadmap_versions enable row level security;
alter table public.learning_roadmap_version_steps enable row level security;

revoke all on table public.learning_roadmap_versions, public.learning_roadmap_version_steps
  from public, anon, authenticated, service_role;
grant select on table public.learning_roadmap_versions, public.learning_roadmap_version_steps to authenticated;

create policy learning_roadmap_versions_select_own on public.learning_roadmap_versions
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id);

create policy learning_roadmap_version_steps_select_own on public.learning_roadmap_version_steps
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id);

-- 4. Immutability triggers --------------------------------------------------------------
-- UPDATE and TRUNCATE are always rejected. DELETE is allowed only once the parent row is
-- gone, i.e. only as the ON DELETE CASCADE of a deleted profile (profile -> versions ->
-- steps); the foreign keys make an orphan impossible otherwise.
create function public.learning_roadmap_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Nested so each table's own columns are only read for that table.
  if tg_op = 'DELETE' then
    if tg_table_name = 'learning_roadmap_versions' then
      if not exists (select 1 from public.profiles p where p.id = old.user_id) then
        return old;
      end if;
    elsif tg_table_name = 'learning_roadmap_version_steps' then
      if not exists (select 1 from public.learning_roadmap_versions v where v.id = old.version_id) then
        return old;
      end if;
    end if;
  end if;
  raise exception 'learning roadmap versions are immutable (% on %)', tg_op, tg_table_name using errcode = '55000';
end;
$$;

revoke all on function public.learning_roadmap_versions_immutable() from public, anon, authenticated, service_role;

create trigger learning_roadmap_versions_immutable_row
  before update or delete on public.learning_roadmap_versions
  for each row execute function public.learning_roadmap_versions_immutable();
create trigger learning_roadmap_versions_immutable_truncate
  before truncate on public.learning_roadmap_versions
  for each statement execute function public.learning_roadmap_versions_immutable();
create trigger learning_roadmap_version_steps_immutable_row
  before update or delete on public.learning_roadmap_version_steps
  for each row execute function public.learning_roadmap_versions_immutable();
create trigger learning_roadmap_version_steps_immutable_truncate
  before truncate on public.learning_roadmap_version_steps
  for each statement execute function public.learning_roadmap_versions_immutable();

-- 5. The only way to create a version (service_role only) -------------------------------
-- p_steps: [{ "order": 1, "phase": "...", "skill": "...", "skillId": "<uuid>|null", "reason": "..." }, ...]
-- Everything is validated before anything is written; one call writes the header and all
-- steps in one transaction, so a partial version cannot exist.
create function public.create_learning_roadmap_version(
  p_user_id        uuid,
  p_input_hash     text,
  p_model          text,
  p_prompt_version text,
  p_generated_at   timestamptz,
  p_steps          jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_number integer;
  v_count  integer;
  v_step   jsonb;
  v_pos    bigint;
  v_text   text;
  v_bad    text;
begin
  -- EXECUTE is granted to service_role only; this also refuses any other active role.
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'create_learning_roadmap_version: service role only' using errcode = '42501';
  end if;

  if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'unknown profile' using errcode = '23503';
  end if;
  if p_input_hash is null or char_length(p_input_hash) not between 1 and 128 then
    raise exception 'input hash must be 1 to 128 characters' using errcode = '22023';
  end if;
  if p_model is null or char_length(p_model) not between 1 and 200 then
    raise exception 'model must be 1 to 200 characters' using errcode = '22023';
  end if;
  if p_prompt_version is null or char_length(p_prompt_version) not between 1 and 50 then
    raise exception 'prompt version must be 1 to 50 characters' using errcode = '22023';
  end if;
  if p_generated_at is null or p_generated_at < timestamptz '2000-01-01 00:00:00+00'
     or p_generated_at > now() + interval '5 minutes' then
    raise exception 'generated_at must be a real past time' using errcode = '22023';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'steps must be a JSON array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_steps);
  if v_count not between 1 and 50 then
    raise exception 'a roadmap version has 1 to 50 steps' using errcode = '22023';
  end if;

  for v_step, v_pos in select e, o from jsonb_array_elements(p_steps) with ordinality as t(e, o) loop
    if jsonb_typeof(v_step) <> 'object' then
      raise exception 'step % must be an object', v_pos using errcode = '22023';
    end if;
    select string_agg(k, ', ' order by k) into v_bad
    from jsonb_object_keys(v_step) k where k not in ('order', 'phase', 'skill', 'skillId', 'reason');
    if v_bad is not null then
      raise exception 'step % has unexpected field(s): %', v_pos, v_bad using errcode = '22023';
    end if;
    -- Steps are numbered exactly 1..N in array order: no gaps, no duplicates, no reordering.
    if jsonb_typeof(v_step -> 'order') is distinct from 'number' or v_step ->> 'order' <> v_pos::text then
      raise exception 'steps must be numbered 1 to N in order (position %)', v_pos using errcode = '22023';
    end if;
    if jsonb_typeof(v_step -> 'skill') is distinct from 'string' then
      raise exception 'step % needs a skill', v_pos using errcode = '22023';
    end if;
    v_text := v_step ->> 'skill';
    if char_length(v_text) not between 1 and 200 or btrim(v_text) = '' then
      raise exception 'step % skill must be 1 to 200 characters', v_pos using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_step -> 'phase'), 'null') <> 'null' then
      if jsonb_typeof(v_step -> 'phase') <> 'string' then
        raise exception 'step % phase must be text', v_pos using errcode = '22023';
      end if;
      v_text := v_step ->> 'phase';
      if char_length(v_text) not between 1 and 200 or btrim(v_text) = '' then
        raise exception 'step % phase must be 1 to 200 characters', v_pos using errcode = '22023';
      end if;
    end if;
    if coalesce(jsonb_typeof(v_step -> 'reason'), 'null') <> 'null' then
      if jsonb_typeof(v_step -> 'reason') <> 'string' then
        raise exception 'step % reason must be text', v_pos using errcode = '22023';
      end if;
      if char_length(v_step ->> 'reason') not between 1 and 2000 then
        raise exception 'step % reason must be 1 to 2000 characters', v_pos using errcode = '22023';
      end if;
    end if;
    if coalesce(jsonb_typeof(v_step -> 'skillId'), 'null') <> 'null' then
      if jsonb_typeof(v_step -> 'skillId') <> 'string'
         or v_step ->> 'skillId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception 'step % skillId must be a skill id', v_pos using errcode = '22023';
      end if;
      if not exists (select 1 from public.skills s where s.id = (v_step ->> 'skillId')::uuid) then
        raise exception 'step % names an unknown skill', v_pos using errcode = '22023';
      end if;
    end if;
  end loop;

  -- One version number at a time per user.
  perform pg_advisory_xact_lock(hashtextextended('learning_roadmap_versions:' || p_user_id::text, 0));
  select coalesce(max(v.version_number), 0) + 1 into v_number
  from public.learning_roadmap_versions v where v.user_id = p_user_id;

  insert into public.learning_roadmap_versions
    (user_id, version_number, input_hash, model, prompt_version, generated_at, step_count)
  values (p_user_id, v_number, p_input_hash, p_model, p_prompt_version, p_generated_at, v_count)
  returning id into v_id;

  insert into public.learning_roadmap_version_steps (version_id, user_id, step_order, phase, skill_text, skill_id, reason)
  select v_id, p_user_id, t.o::smallint,
         case when jsonb_typeof(t.e -> 'phase') = 'string' then t.e ->> 'phase' end,
         t.e ->> 'skill',
         case when jsonb_typeof(t.e -> 'skillId') = 'string' then (t.e ->> 'skillId')::uuid end,
         case when jsonb_typeof(t.e -> 'reason') = 'string' then t.e ->> 'reason' end
  from jsonb_array_elements(p_steps) with ordinality as t(e, o);

  return v_id;
end;
$$;

revoke all on function public.create_learning_roadmap_version(uuid, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_learning_roadmap_version(uuid, text, text, text, timestamptz, jsonb) to service_role;

-- 6. At most one ACTIVE completion per (user, skill, version, step) ------------------------
create unique index skill_evidence_roadmap_completion_key
  on public.skill_evidence (user_id, skill_id, (metadata ->> 'roadmap_version_id'), (metadata ->> 'roadmap_step'))
  where evidence_type = 'learning' and retracted_at is null and (metadata ->> 'source') = 'roadmap';

-- 7. Completing a step of the caller's latest version (authenticated) ----------------------
create function public.complete_roadmap_learning_step(
  p_version_id uuid,
  p_step_order integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user        uuid := auth.uid();
  v_version     public.learning_roadmap_versions%rowtype;
  v_step        public.learning_roadmap_version_steps%rowtype;
  v_skill_name  text;
  v_title       text;
  v_description text;
  v_meta        jsonb;
  v_row         public.skill_evidence%rowtype;
  v_created     boolean := false;
begin
  if v_user is null then
    raise exception 'complete_roadmap_learning_step: not authenticated' using errcode = '42501';
  end if;
  if p_version_id is null then
    raise exception 'a roadmap version is required' using errcode = '22023';
  end if;
  if p_step_order is null or p_step_order not between 1 and 50 then
    raise exception 'the roadmap step must be a whole number from 1 to 50' using errcode = '22023';
  end if;

  -- Only the caller's own versions exist here; another user's id reads as "not found".
  select * into v_version from public.learning_roadmap_versions v
  where v.id = p_version_id and v.user_id = v_user;
  if v_version.id is null then
    raise exception 'roadmap version not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.learning_roadmap_versions v
             where v.user_id = v_user and v.version_number > v_version.version_number) then
    raise exception 'this roadmap has been replaced by a newer version' using errcode = 'SB409';
  end if;

  select * into v_step from public.learning_roadmap_version_steps s
  where s.version_id = v_version.id and s.step_order = p_step_order;
  if v_step.version_id is null then
    raise exception 'that step is not in this roadmap version' using errcode = 'P0002';
  end if;
  if v_step.skill_id is null then
    raise exception 'this roadmap step uses a skill that could not be matched to the catalog' using errcode = 'SB422';
  end if;

  select k.name into v_skill_name from public.skills k where k.id = v_step.skill_id;

  -- Title, description and snapshot come from the immutable version only.
  v_title := btrim(left(regexp_replace(coalesce(v_step.phase || ': ', '') || v_step.skill_text, '[[:cntrl:]]+', ' ', 'g'), 200));
  v_description := left(regexp_replace(
    'Completed learning step ' || v_step.step_order || ' of your SkillBridge roadmap.' || coalesce(' ' || v_step.reason, ''),
    '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]+', ' ', 'g'), 2000);
  v_meta := jsonb_build_object(
    'source', 'roadmap',
    'roadmap_version_id', v_version.id,
    'roadmap_step', v_step.step_order,
    'roadmap_skill', v_step.skill_text,
    'skill_name', v_skill_name);

  select * into v_row from public.skill_evidence e
  where e.user_id = v_user and e.skill_id = v_step.skill_id and e.evidence_type = 'learning'
    and e.retracted_at is null and e.metadata ->> 'source' = 'roadmap'
    and e.metadata ->> 'roadmap_version_id' = v_version.id::text
    and e.metadata ->> 'roadmap_step' = v_step.step_order::text;

  if v_row.id is null then
    if (select count(*) from public.skill_evidence e where e.user_id = v_user) >= 1000 then
      raise exception 'evidence limit reached (1000 records)' using errcode = '54000';
    end if;

    insert into public.skill_evidence (user_id, skill_id, evidence_type, title, description, metadata, observed_at)
    values (v_user, v_step.skill_id, 'learning', v_title, v_description, v_meta, now())
    on conflict (user_id, skill_id, (metadata ->> 'roadmap_version_id'), (metadata ->> 'roadmap_step'))
      where evidence_type = 'learning' and retracted_at is null and (metadata ->> 'source') = 'roadmap'
      do nothing
    returning * into v_row;

    v_created := v_row.id is not null;

    -- A concurrent call recorded the same completion first: return that row.
    if not v_created then
      select * into v_row from public.skill_evidence e
      where e.user_id = v_user and e.skill_id = v_step.skill_id and e.evidence_type = 'learning'
        and e.retracted_at is null and e.metadata ->> 'source' = 'roadmap'
        and e.metadata ->> 'roadmap_version_id' = v_version.id::text
        and e.metadata ->> 'roadmap_step' = v_step.step_order::text;
    end if;
  end if;

  return jsonb_build_object(
    'created', v_created,
    'evidence', to_jsonb(v_row),
    'progress', (select to_jsonb(p) from public.skill_progress p where p.user_id = v_user and p.skill_id = v_step.skill_id));
end;
$$;

revoke all on function public.complete_roadmap_learning_step(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.complete_roadmap_learning_step(uuid, integer) to authenticated;

-- 8. Self-check before commit: any mismatch aborts and rolls everything back ----------
do $$
declare
  t   text;
  f   text;
  bad text;
begin
  foreach t in array array['learning_roadmap_versions', 'learning_roadmap_version_steps'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception 'self-check failed: RLS is off on %', t;
    end if;
    if (select count(*) from pg_policies where schemaname = 'public' and tablename = t) <> 1
       or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                      and cmd = 'SELECT' and roles = '{authenticated}' and permissive = 'PERMISSIVE') then
      raise exception 'self-check failed: % must have exactly one owner SELECT policy', t;
    end if;
    if not has_table_privilege('authenticated', format('public.%I', t), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', t), 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_table_privilege('anon', format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_table_privilege('service_role', format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                  where c.oid = format('public.%I', t)::regclass and a.grantee = 0) then
      raise exception 'self-check failed: privileges on % are not exactly authenticated SELECT', t;
    end if;
    if (select count(*) from pg_trigger where tgrelid = format('public.%I', t)::regclass and not tgisinternal
        and tgfoid = 'public.learning_roadmap_versions_immutable()'::regprocedure) <> 2 then
      raise exception 'self-check failed: % is missing its immutability triggers', t;
    end if;
  end loop;

  foreach f in array array['public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)',
                           'public.complete_roadmap_learning_step(uuid,integer)',
                           'public.learning_roadmap_versions_immutable()'] loop
    if not exists (select 1 from pg_proc where oid = f::regprocedure and proconfig = array['search_path=""']) then
      raise exception 'self-check failed: % must pin an empty search_path', f;
    end if;
    if (select proowner from pg_proc where oid = f::regprocedure) <> (select oid from pg_roles where rolname = current_user) then
      raise exception 'self-check failed: % is not owned by the migration role', f;
    end if;
    if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
               where p.oid = f::regprocedure and a.grantee = 0) then
      raise exception 'self-check failed: PUBLIC may execute %', f;
    end if;
  end loop;
  if not (select prosecdef from pg_proc where oid = 'public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.complete_roadmap_learning_step(uuid,integer)'::regprocedure) then
    raise exception 'self-check failed: the two functions must be SECURITY DEFINER';
  end if;
  if not has_function_privilege('service_role', 'public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)', 'EXECUTE') then
    raise exception 'self-check failed: only service_role may create roadmap versions';
  end if;
  if not has_function_privilege('authenticated', 'public.complete_roadmap_learning_step(uuid,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_roadmap_learning_step(uuid,integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.complete_roadmap_learning_step(uuid,integer)', 'EXECUTE') then
    raise exception 'self-check failed: only authenticated may complete roadmap steps';
  end if;
  if pg_has_role('anon', current_user, 'MEMBER') or pg_has_role('authenticated', current_user, 'MEMBER')
     or pg_has_role('service_role', current_user, 'MEMBER') then
    raise exception 'self-check failed: an API role is a member of the function owner and could alter the functions';
  end if;

  if not exists (
    select 1 from pg_index i
    where i.indexrelid = to_regclass('public.skill_evidence_roadmap_completion_key')
      and i.indrelid = 'public.skill_evidence'::regclass
      and i.indisunique and i.indisvalid and i.indimmediate and i.indnatts = 4 and i.indnkeyatts = 4
      and pg_get_indexdef(i.indexrelid) = $def$CREATE UNIQUE INDEX skill_evidence_roadmap_completion_key ON public.skill_evidence USING btree (user_id, skill_id, ((metadata ->> 'roadmap_version_id'::text)), ((metadata ->> 'roadmap_step'::text))) WHERE ((evidence_type = 'learning'::text) AND (retracted_at IS NULL) AND ((metadata ->> 'source'::text) = 'roadmap'::text))$def$
  ) then
    raise exception 'self-check failed: skill_evidence_roadmap_completion_key is not exactly the reviewed definition';
  end if;
end $$;

commit;
