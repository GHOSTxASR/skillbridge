-- =============================================================================
-- P1.8: per-user AI generation limits (public.ai_rate_limits, consume_ai_generation)
-- =============================================================================
-- Admission control for AI generations. Before an API route asks Groq for a new chat
-- reply, skill-gap analysis or learning roadmap, it calls
-- public.consume_ai_generation(operation), which counts the generation against the
-- signed-in user's limits and says whether it may go ahead. Cache hits never call it.
-- The counts live here, not in server memory, so every server instance sees the same
-- counts.
--
-- Limits, per user and operation. Windows are fixed, aligned to the UTC epoch, and both
-- must have room. A denied request is not counted; an admitted one stays counted even
-- if the generation then fails.
--
--   operation         per 10 minutes   per hour
--   chat                    20             60
--   career_analysis          5             15
--   learning                 3             10
--
-- Changing a limit means replacing this function in a new migration.
--
-- One row per (user, operation) holds the current 10-minute and hourly counts, so the
-- table holds at most 3 rows per user and needs no cleanup job. Rows belong to the auth
-- user (ON DELETE CASCADE): chat is also available before a profile exists.
--
-- Access: only the function reads or writes the table. RLS is on with no policies, and
-- anon, authenticated and PUBLIC hold no table privileges. The function is SECURITY
-- DEFINER with an empty search_path, takes only the operation name, and always acts on
-- auth.uid(): a caller can use up their own allowance, never read, reset or touch anyone
-- else's. Only authenticated may execute it. service_role and postgres privileges are
-- not touched.
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
    where con.conrelid = to_regclass('auth.users')
      and con.contype = 'p'
      and array_length(con.conkey, 1) = 1
      and att.attname = 'id'
      and att.atttypid = 'uuid'::regtype
  ) then
    raise exception 'P1.8 migration aborted, nothing changed: auth.users with a uuid primary key "id" is required';
  end if;

  if to_regprocedure('auth.uid()') is null then
    raise exception 'P1.8 migration aborted, nothing changed: auth.uid() is required';
  end if;

  if (select count(*) from pg_roles where rolname in ('anon', 'authenticated')) <> 2 then
    raise exception 'P1.8 migration aborted, nothing changed: the anon and authenticated roles are required';
  end if;
end $$;

-- 2. Table ----------------------------------------------------------------------
create table if not exists public.ai_rate_limits (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  operation    text        not null,
  window_start timestamptz not null,
  window_count integer     not null default 0,
  hour_start   timestamptz not null,
  hour_count   integer     not null default 0,
  updated_at   timestamptz not null default now(),
  constraint ai_rate_limits_pkey primary key (user_id, operation),
  constraint ai_rate_limits_operation
    check (operation in ('chat', 'career_analysis', 'learning')),
  constraint ai_rate_limits_counts
    check (window_count >= 0 and hour_count >= 0)
);

alter table public.ai_rate_limits enable row level security;

-- 3. No direct access -----------------------------------------------------------
-- New public tables inherit Supabase's default grants (ALL to anon and authenticated);
-- this table is reached only through the function below.
revoke all on table public.ai_rate_limits from anon, authenticated, public;

do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'ai_rate_limits'
  loop
    execute format('drop policy %I on public.ai_rate_limits', p.policyname);
  end loop;
end $$;

-- 4. Admission function -------------------------------------------------------------
-- Returns {"allowed": true}, or {"allowed": false, "retry_after_seconds": n} when a
-- window is full. Raises for an unknown operation or a caller without auth.uid().
create or replace function public.consume_ai_generation(p_operation text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user         uuid := auth.uid();
  v_window_limit integer;
  v_hour_limit   integer;
  v_now          timestamptz;
  v_window_start timestamptz;
  v_hour_start   timestamptz;
  v_row          public.ai_rate_limits%rowtype;
  v_retry        numeric := 0;
begin
  if v_user is null then
    raise exception 'consume_ai_generation: not authenticated' using errcode = '42501';
  end if;

  case p_operation
    when 'chat'            then v_window_limit := 20; v_hour_limit := 60;
    when 'career_analysis' then v_window_limit := 5;  v_hour_limit := 15;
    when 'learning'        then v_window_limit := 3;  v_hour_limit := 10;
    else
      raise exception 'consume_ai_generation: unknown operation' using errcode = '22023';
  end case;

  -- Make sure the row exists, then lock it: simultaneous calls for the same user and
  -- operation wait here, and each one sees the count the previous one committed.
  insert into public.ai_rate_limits (user_id, operation, window_start, hour_start)
  values (v_user, p_operation, '-infinity', '-infinity')
  on conflict (user_id, operation) do nothing;

  select * into strict v_row
  from public.ai_rate_limits
  where user_id = v_user and operation = p_operation
  for update;

  -- The database clock, read after the lock, picks the windows; nothing comes from the
  -- caller. date_bin with an explicit UTC origin does not depend on the session time zone.
  v_now := clock_timestamp();
  v_window_start := date_bin(interval '10 minutes', v_now, timestamptz '1970-01-01 00:00:00+00');
  v_hour_start := date_bin(interval '1 hour', v_now, timestamptz '1970-01-01 00:00:00+00');

  if v_row.window_start < v_window_start then
    v_row.window_start := v_window_start;
    v_row.window_count := 0;
  end if;

  if v_row.hour_start < v_hour_start then
    v_row.hour_start := v_hour_start;
    v_row.hour_count := 0;
  end if;

  -- Full: report when every full window has reset, and count nothing.
  if v_row.window_count >= v_window_limit or v_row.hour_count >= v_hour_limit then
    if v_row.window_count >= v_window_limit then
      v_retry := greatest(v_retry, extract(epoch from (v_row.window_start + interval '10 minutes' - v_now)));
    end if;

    if v_row.hour_count >= v_hour_limit then
      v_retry := greatest(v_retry, extract(epoch from (v_row.hour_start + interval '1 hour' - v_now)));
    end if;

    return jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', greatest(1, ceil(v_retry))::integer
    );
  end if;

  update public.ai_rate_limits
     set window_start = v_row.window_start,
         window_count = v_row.window_count + 1,
         hour_start   = v_row.hour_start,
         hour_count   = v_row.hour_count + 1,
         updated_at   = v_now
   where user_id = v_user and operation = p_operation;

  return jsonb_build_object('allowed', true);
end;
$$;

-- Functions are executable by PUBLIC by default, and Supabase also grants new public
-- functions to anon: only signed-in users may call this one.
revoke all on function public.consume_ai_generation(text) from public, anon, authenticated;
grant execute on function public.consume_ai_generation(text) to authenticated;

-- 5. Self-check before commit: any mismatch aborts and rolls everything back ----
do $$
declare
  bad text;
  fn  regprocedure := 'public.consume_ai_generation(text)'::regprocedure;
begin
  with expected(col, typ, not_null, has_default) as (
    values ('user_id',      'uuid',                     true, false),
           ('operation',    'text',                     true, false),
           ('window_start', 'timestamp with time zone', true, false),
           ('window_count', 'integer',                  true, true),
           ('hour_start',   'timestamp with time zone', true, false),
           ('hour_count',   'integer',                  true, true),
           ('updated_at',   'timestamp with time zone', true, true)
  ),
  actual as (
    select a.attname::text as col,
           format_type(a.atttypid, a.atttypmod) as typ,
           a.attnotnull as not_null,
           a.atthasdef as has_default
    from pg_attribute a
    where a.attrelid = 'public.ai_rate_limits'::regclass
      and a.attnum > 0
      and not a.attisdropped
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || col || ' ' || typ as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || col || ' ' || typ from (select * from expected except select * from actual) y)
  ) z;
  if bad is not null then
    raise exception 'P1.8 self-check failed: columns differ from the intended table: %', bad;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_rate_limits'::regclass
      and contype = 'p'
      and conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.ai_rate_limits'::regclass and attname = 'user_id'),
        (select attnum from pg_attribute where attrelid = 'public.ai_rate_limits'::regclass and attname = 'operation')
      ]::int2[]
  ) then
    raise exception 'P1.8 self-check failed: the primary key is not (user_id, operation)';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_rate_limits'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and confdeltype = 'c'
  ) then
    raise exception 'P1.8 self-check failed: missing ON DELETE CASCADE foreign key to auth.users';
  end if;

  if (
    select count(*) from pg_constraint
    where conrelid = 'public.ai_rate_limits'::regclass
      and contype = 'c'
      and conname in ('ai_rate_limits_operation', 'ai_rate_limits_counts')
  ) <> 2 then
    raise exception 'P1.8 self-check failed: check constraints are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.ai_rate_limits'::regclass) then
    raise exception 'P1.8 self-check failed: RLS is not enabled';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_rate_limits') then
    raise exception 'P1.8 self-check failed: ai_rate_limits must have no policies';
  end if;

  select string_agg(grantee || ' ' || priv, ', ') into bad from (
    select case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as grantee,
           a.privilege_type::text as priv
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    left join pg_roles r on r.oid = a.grantee
    where c.oid = 'public.ai_rate_limits'::regclass
      and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  ) x;
  if bad is not null
     or has_table_privilege('anon', 'public.ai_rate_limits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.ai_rate_limits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception 'P1.8 self-check failed: anon, authenticated or PUBLIC can access ai_rate_limits directly: %', coalesce(bad, 'inherited privilege');
  end if;

  if (select count(*) from pg_proc
      where pronamespace = 'public'::regnamespace and proname = 'consume_ai_generation') <> 1 then
    raise exception 'P1.8 self-check failed: consume_ai_generation must have exactly one signature';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = fn
      and prosecdef
      and provolatile = 'v'
      and prorettype = 'jsonb'::regtype
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'P1.8 self-check failed: consume_ai_generation must be a volatile SECURITY DEFINER function returning jsonb with an empty search_path';
  end if;

  if not has_function_privilege('authenticated', fn, 'EXECUTE')
     or has_function_privilege('anon', fn, 'EXECUTE')
     or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = fn and a.grantee = 0) then
    raise exception 'P1.8 self-check failed: consume_ai_generation must be executable by authenticated only (not anon or PUBLIC)';
  end if;

  raise notice 'P1.8 self-check passed: ai_rate_limits structure, RLS with no policies, no direct access, consume_ai_generation secured';
end $$;

commit;
