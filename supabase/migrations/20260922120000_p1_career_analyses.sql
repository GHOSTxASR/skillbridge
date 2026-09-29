-- =============================================================================
-- P1: persisted per-user skill-gap analyses (public.career_analyses)
-- =============================================================================
-- Stores the latest validated AI skill-gap analysis for each user, so the gap-analysis
-- page reuses it instead of calling the AI on every visit. One row per user: user_id is
-- the primary key and follows the profile's lifetime (ON DELETE CASCADE, like
-- learning_roadmaps and the other per-user tables that reference profiles).
--
-- Only genuine AI output is written (never the estimate shown when the AI is
-- unavailable). The app reuses a row only when input_hash, model and prompt_version all
-- match the current request and the stored analysis passes validation.
--
-- Access: the app writes this table with the signed-in user's session, so the owner may
-- select / insert / update their own row (auth.uid() = user_id). No delete policy, no
-- anon access, no PUBLIC grant. service_role and postgres privileges are not touched.
-- The owner can also write their row directly through the Data API, so every column is
-- size-capped.
-- generated_at defaults to now() on insert only; writers must set it on update.
--
-- Safe to re-run. Aborts, changing nothing, if a precondition or the final self-check
-- fails.
-- =============================================================================

begin;

-- 1. Preconditions ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.conrelid = to_regclass('public.profiles')
      and con.contype = 'p'
      and array_length(con.conkey, 1) = 1
      and att.attname = 'id'
      and att.atttypid = 'uuid'::regtype
  ) then
    raise exception 'P1 migration aborted, nothing changed: public.profiles with a uuid primary key "id" is required';
  end if;
end $$;

-- 2. Table ----------------------------------------------------------------------
create table if not exists public.career_analyses (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  input_hash     text not null,
  analysis       jsonb not null,
  model          text not null,
  generated_at   timestamptz not null default now(),
  prompt_version text not null,
  constraint career_analyses_analysis_object
    check (jsonb_typeof(analysis) = 'object'),
  constraint career_analyses_analysis_size
    check (octet_length(analysis::text) <= 100000),
  constraint career_analyses_text_sizes
    check (
      char_length(input_hash) <= 128
      and char_length(model) <= 200
      and char_length(prompt_version) <= 50
    )
);

alter table public.career_analyses enable row level security;

-- 3. Minimum API privileges -------------------------------------------------------
-- New public tables inherit Supabase's default grants (ALL to anon and authenticated),
-- so clear them and grant only what the owner-only policies need.
revoke all on table public.career_analyses from anon, authenticated, public;
grant select, insert, update on table public.career_analyses to authenticated;

-- 4. Policies: drop-and-recreate so a re-run ends in exactly this set ---------------
do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'career_analyses'
  loop
    execute format('drop policy %I on public.career_analyses', p.policyname);
  end loop;
end $$;

create policy career_analyses_select_own on public.career_analyses
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id);

create policy career_analyses_insert_own on public.career_analyses
  as permissive for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- with check stops an owner re-pointing their row at another user.
create policy career_analyses_update_own on public.career_analyses
  as permissive for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 5. Self-check before commit: any mismatch aborts and rolls everything back ----
do $$
declare bad text;
begin
  with expected(col, typ, not_null, has_default) as (
    values ('user_id',        'uuid',                     true, false),
           ('input_hash',     'text',                     true, false),
           ('analysis',       'jsonb',                    true, false),
           ('model',          'text',                     true, false),
           ('generated_at',   'timestamp with time zone', true, true),
           ('prompt_version', 'text',                     true, false)
  ),
  actual as (
    select a.attname::text as col,
           format_type(a.atttypid, a.atttypmod) as typ,
           a.attnotnull as not_null,
           a.atthasdef as has_default
    from pg_attribute a
    where a.attrelid = 'public.career_analyses'::regclass
      and a.attnum > 0
      and not a.attisdropped
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || col || ' ' || typ as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || col || ' ' || typ from (select * from expected except select * from actual) y)
  ) z;
  if bad is not null then
    raise exception 'P1 self-check failed: columns differ from the intended table: %', bad;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.career_analyses'::regclass
      and contype = 'p'
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.career_analyses'::regclass and attname = 'user_id'
      )]::int2[]
  ) then
    raise exception 'P1 self-check failed: user_id is not the primary key';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.career_analyses'::regclass
      and contype = 'f'
      and confrelid = 'public.profiles'::regclass
      and confdeltype = 'c'
  ) then
    raise exception 'P1 self-check failed: missing ON DELETE CASCADE foreign key to public.profiles';
  end if;

  if (
    select count(*) from pg_constraint
    where conrelid = 'public.career_analyses'::regclass
      and contype = 'c'
      and conname in ('career_analyses_analysis_object', 'career_analyses_analysis_size',
                      'career_analyses_text_sizes')
  ) <> 3 then
    raise exception 'P1 self-check failed: check constraints are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.career_analyses'::regclass) then
    raise exception 'P1 self-check failed: RLS is not enabled';
  end if;

  with expected(policyname, cmd, roles) as (
    values ('career_analyses_select_own', 'SELECT', 'authenticated'),
           ('career_analyses_insert_own', 'INSERT', 'authenticated'),
           ('career_analyses_update_own', 'UPDATE', 'authenticated')
  ),
  actual as (
    select policyname::text, cmd::text,
           (select string_agg(r::text, ',' order by r::text) from unnest(roles) r) as roles
    from pg_policies
    where schemaname = 'public' and tablename = 'career_analyses'
      and permissive = 'PERMISSIVE'
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || policyname || ' ' || cmd || ' to ' || roles as d
     from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || policyname from (select * from expected except select * from actual) y)
    union all
    (select 'restrictive ' || policyname from pg_policies
     where schemaname = 'public' and tablename = 'career_analyses' and permissive <> 'PERMISSIVE')
  ) z;
  if bad is not null then
    raise exception 'P1 self-check failed: policy set differs from the intended model: %', bad;
  end if;

  with expected(grantee, priv) as (
    values ('authenticated', 'SELECT'), ('authenticated', 'INSERT'), ('authenticated', 'UPDATE')
  ),
  actual as (
    select case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as grantee,
           a.privilege_type::text as priv
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    left join pg_roles r on r.oid = a.grantee
    where c.oid = 'public.career_analyses'::regclass
      and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || grantee || ' ' || priv as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || grantee || ' ' || priv from (select * from expected except select * from actual) y)
  ) z;
  if bad is not null then
    raise exception 'P1 self-check failed: privileges differ from the intended model: %', bad;
  end if;

  -- Effective privileges, including anything inherited through role membership.
  if has_table_privilege('anon', 'public.career_analyses', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.career_analyses', 'DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception 'P1 self-check failed: anon or authenticated holds an effective privilege it should not';
  end if;

  raise notice 'P1 self-check passed: career_analyses structure, RLS, 3 owner policies, minimum privileges';
end $$;

commit;
