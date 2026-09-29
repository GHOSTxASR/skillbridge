-- =============================================================================
-- P1: persisted per-user learning roadmaps (public.learning_roadmaps)
-- =============================================================================
-- Stores the latest successfully generated AI roadmap for each user, so the dashboard
-- and the roadmap page can share one result instead of regenerating it on every call.
-- One row per user: user_id is the primary key and follows the profile's lifetime
-- (ON DELETE CASCADE, like the other per-user tables that reference profiles).
--
-- Access: the app will write this table with the signed-in user's session, so the owner
-- may select / insert / update their own row (auth.uid() = user_id). No delete policy,
-- no anon access, no PUBLIC grant. service_role and postgres privileges are not touched.
--
-- Because the owner can also write their row directly through the Data API, roadmap and
-- ai_summary are size-capped so one user cannot store unbounded data.
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
create table if not exists public.learning_roadmaps (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  input_hash     text not null,
  roadmap        jsonb not null,
  ai_summary     text,
  model          text not null,
  generated_at   timestamptz not null default now(),
  prompt_version text not null,
  constraint learning_roadmaps_roadmap_size
    check (octet_length(roadmap::text) <= 100000),
  constraint learning_roadmaps_ai_summary_length
    check (ai_summary is null or char_length(ai_summary) <= 10000)
);

alter table public.learning_roadmaps enable row level security;

-- 3. Minimum API privileges -------------------------------------------------------
-- New public tables inherit Supabase's default grants (ALL to anon and authenticated),
-- so clear them and grant only what the owner-only policies need.
revoke all on table public.learning_roadmaps from anon, authenticated, public;
grant select, insert, update on table public.learning_roadmaps to authenticated;

-- 4. Policies: drop-and-recreate so a re-run ends in exactly this set ---------------
do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'learning_roadmaps'
  loop
    execute format('drop policy %I on public.learning_roadmaps', p.policyname);
  end loop;
end $$;

create policy learning_roadmaps_select_own on public.learning_roadmaps
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id);

create policy learning_roadmaps_insert_own on public.learning_roadmaps
  as permissive for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- with check stops an owner re-pointing their row at another user.
create policy learning_roadmaps_update_own on public.learning_roadmaps
  as permissive for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 5. Self-check before commit: any mismatch aborts and rolls everything back ----
do $$
declare bad text;
begin
  with expected(col, typ, not_null, has_default) as (
    values ('user_id',        'uuid',                     true,  false),
           ('input_hash',     'text',                     true,  false),
           ('roadmap',        'jsonb',                    true,  false),
           ('ai_summary',     'text',                     false, false),
           ('model',          'text',                     true,  false),
           ('generated_at',   'timestamp with time zone', true,  true),
           ('prompt_version', 'text',                     true,  false)
  ),
  actual as (
    select a.attname::text as col,
           format_type(a.atttypid, a.atttypmod) as typ,
           a.attnotnull as not_null,
           a.atthasdef as has_default
    from pg_attribute a
    where a.attrelid = 'public.learning_roadmaps'::regclass
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
    where conrelid = 'public.learning_roadmaps'::regclass
      and contype = 'p'
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.learning_roadmaps'::regclass and attname = 'user_id'
      )]::int2[]
  ) then
    raise exception 'P1 self-check failed: user_id is not the primary key';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_roadmaps'::regclass
      and contype = 'f'
      and confrelid = 'public.profiles'::regclass
      and confdeltype = 'c'
  ) then
    raise exception 'P1 self-check failed: missing ON DELETE CASCADE foreign key to public.profiles';
  end if;

  if (
    select count(*) from pg_constraint
    where conrelid = 'public.learning_roadmaps'::regclass
      and contype = 'c'
      and conname in ('learning_roadmaps_roadmap_size', 'learning_roadmaps_ai_summary_length')
  ) <> 2 then
    raise exception 'P1 self-check failed: size check constraints are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.learning_roadmaps'::regclass) then
    raise exception 'P1 self-check failed: RLS is not enabled';
  end if;

  with expected(policyname, cmd, roles) as (
    values ('learning_roadmaps_select_own', 'SELECT', 'authenticated'),
           ('learning_roadmaps_insert_own', 'INSERT', 'authenticated'),
           ('learning_roadmaps_update_own', 'UPDATE', 'authenticated')
  ),
  actual as (
    select policyname::text, cmd::text,
           (select string_agg(r::text, ',' order by r::text) from unnest(roles) r) as roles
    from pg_policies
    where schemaname = 'public' and tablename = 'learning_roadmaps'
      and permissive = 'PERMISSIVE'
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || policyname || ' ' || cmd || ' to ' || roles as d
     from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || policyname from (select * from expected except select * from actual) y)
    union all
    (select 'restrictive ' || policyname from pg_policies
     where schemaname = 'public' and tablename = 'learning_roadmaps' and permissive <> 'PERMISSIVE')
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
    where c.oid = 'public.learning_roadmaps'::regclass
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
  if has_table_privilege('anon', 'public.learning_roadmaps', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.learning_roadmaps', 'DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception 'P1 self-check failed: anon or authenticated holds an effective privilege it should not';
  end if;

  raise notice 'P1 self-check passed: learning_roadmaps structure, RLS, 3 owner policies, minimum privileges';
end $$;

commit;
