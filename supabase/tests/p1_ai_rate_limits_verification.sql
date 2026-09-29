-- =============================================================================
-- P1.8 verification for public.ai_rate_limits and public.consume_ai_generation()
-- =============================================================================
-- Run the WHOLE script at once in the Supabase SQL Editor (do not run a selection),
-- as the database owner (the editor's default postgres role).
--
-- What it does:
--   * Checks structure: table, columns, primary key, the ON DELETE CASCADE foreign key to
--     auth.users, check constraints, RLS with no policies, no table privileges for
--     anon/authenticated/PUBLIC, and the function's security settings and EXECUTE grants.
--   * Creates TEMPORARY auth users A and B (random ids, @example.invalid addresses),
--     impersonates anon and authenticated exactly as the Supabase Data API does
--     (SET ROLE + request.jwt.claims) and exercises the limiter: each limit, denials that
--     are not counted, Retry-After, 10-minute and hourly window resets, operation and user
--     isolation, and every forbidden direct access.
--   * Fingerprints real rate-limit rows before the tests and proves nothing real changed.
--
-- Truly simultaneous calls need two database sessions, which one script cannot open. The
-- function serialises them with a row lock (checked structurally below); the concurrent
-- behaviour is exercised through the Data API after the migration.
--
-- It NEVER keeps any change: the script always ends in an error, so everything rolls back.
--   Success: the error message starts with  "P1 AI_RATE_LIMITS VERIFICATION PASSED"
--   Failure: the error message starts with  "FAIL:"  and names the failing check
--   Setup problem (not a security result):  "SETUP ERROR:"
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.ai_rate_limits') is null then
    raise exception 'FAIL: table public.ai_rate_limits does not exist';
  end if;
  if to_regprocedure('public.consume_ai_generation(text)') is null then
    raise exception 'FAIL: function public.consume_ai_generation(text) does not exist';
  end if;
end $$;

-- 0. Baselines, captured as the table owner (reads only) ------------------------
select set_config('p18.a', gen_random_uuid()::text, true),   -- test user A (the caller)
       set_config('p18.b', gen_random_uuid()::text, true),   -- test user B (another user)
       set_config('p18.c', gen_random_uuid()::text, true);   -- an id with no auth user

select set_config('p18.real_limits',
         (select md5(coalesce(string_agg(r::text, '|' order by r.user_id, r.operation), '')) from public.ai_rate_limits r), true);

-- 1. Structure ------------------------------------------------------------------
do $$
declare
  bad text;
  fn  regprocedure := 'public.consume_ai_generation(text)'::regprocedure;
  def text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.ai_rate_limits'::regclass) then
    raise exception 'FAIL: RLS is not enabled on ai_rate_limits';
  end if;
  raise notice 'PASS: table exists, RLS enabled';

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
    where a.attrelid = 'public.ai_rate_limits'::regclass and a.attnum > 0 and not a.attisdropped
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || col || ' ' || typ || ' not_null=' || not_null as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || col || ' ' || typ || ' not_null=' || not_null from (select * from expected except select * from actual) y)
  ) z;
  if bad is not null then raise exception 'FAIL: columns differ from the intended table: %', bad; end if;
  raise notice 'PASS: columns, types, NOT NULL and defaults are as intended';

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_rate_limits'::regclass and contype = 'p'
      and conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.ai_rate_limits'::regclass and attname = 'user_id'),
        (select attnum from pg_attribute where attrelid = 'public.ai_rate_limits'::regclass and attname = 'operation')
      ]::int2[]
  ) then
    raise exception 'FAIL: the primary key is not (user_id, operation)';
  end if;
  raise notice 'PASS: primary key (user_id, operation): one row per user and operation, and the index every call uses';

  select string_agg(conname::text, ', ') into bad
  from pg_constraint
  where conrelid = 'public.ai_rate_limits'::regclass and contype = 'f'
    and not (confrelid = 'auth.users'::regclass and confdeltype = 'c'
             and conkey = array[(select attnum from pg_attribute
                                 where attrelid = 'public.ai_rate_limits'::regclass and attname = 'user_id')]::int2[]
             and confkey = array[(select attnum from pg_attribute
                                  where attrelid = 'auth.users'::regclass and attname = 'id')]::int2[]);
  if bad is not null
     or (select count(*) from pg_constraint where conrelid = 'public.ai_rate_limits'::regclass and contype = 'f') <> 1 then
    raise exception 'FAIL: ai_rate_limits needs exactly one foreign key: user_id -> auth.users(id) ON DELETE CASCADE';
  end if;
  raise notice 'PASS: user_id references auth.users(id) ON DELETE CASCADE (its only foreign key)';

  if (select count(*) from pg_constraint
      where conrelid = 'public.ai_rate_limits'::regclass and contype = 'c'
        and conname in ('ai_rate_limits_operation', 'ai_rate_limits_counts')) <> 2 then
    raise exception 'FAIL: check constraints ai_rate_limits_operation / ai_rate_limits_counts are missing';
  end if;
  raise notice 'PASS: operation and count check constraints exist';

  select string_agg(policyname, ', ') into bad
  from pg_policies where schemaname = 'public' and tablename = 'ai_rate_limits';
  if bad is not null then raise exception 'FAIL: ai_rate_limits must have no policies, found: %', bad; end if;
  raise notice 'PASS: no policies (nothing is reachable through the Data API)';

  select string_agg(grantee || ' ' || priv, ', ') into bad from (
    select case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as grantee,
           a.privilege_type::text as priv
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    left join pg_roles r on r.oid = a.grantee
    where c.oid = 'public.ai_rate_limits'::regclass
      and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  ) x;
  if bad is not null then raise exception 'FAIL: table privileges that should not exist: %', bad; end if;
  if has_table_privilege('anon', 'public.ai_rate_limits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.ai_rate_limits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception 'FAIL: anon or authenticated holds an effective privilege on ai_rate_limits';
  end if;
  raise notice 'PASS: anon, authenticated and PUBLIC have no privilege on ai_rate_limits (including inherited ones)';

  if exists (select 1 from pg_roles where rolname = 'service_role')
     and not has_table_privilege('service_role', 'public.ai_rate_limits', 'SELECT') then
    raise exception 'FAIL: service_role lost its privileges on ai_rate_limits';
  end if;
  raise notice 'PASS: service_role privileges preserved';

  if (select count(*) from pg_proc
      where pronamespace = 'public'::regnamespace and proname = 'consume_ai_generation') <> 1 then
    raise exception 'FAIL: consume_ai_generation must have exactly one signature (no variant taking a user id)';
  end if;
  if not exists (select 1 from pg_proc where oid = fn and prosecdef) then
    raise exception 'FAIL: consume_ai_generation is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where oid = fn and proconfig @> array['search_path=""']) then
    raise exception 'FAIL: consume_ai_generation does not pin an empty search_path';
  end if;
  if not exists (select 1 from pg_proc where oid = fn and provolatile = 'v' and prorettype = 'jsonb'::regtype) then
    raise exception 'FAIL: consume_ai_generation must be VOLATILE and return jsonb';
  end if;
  raise notice 'PASS: one signature (operation only), SECURITY DEFINER, empty search_path, volatile, returns jsonb';

  if not has_function_privilege('authenticated', fn, 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute consume_ai_generation';
  end if;
  if has_function_privilege('anon', fn, 'EXECUTE')
     or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = fn and a.grantee = 0) then
    raise exception 'FAIL: anon or PUBLIC can execute consume_ai_generation';
  end if;
  raise notice 'PASS: only authenticated (not anon or PUBLIC) may execute consume_ai_generation';

  -- Structural guard for the concurrency property: the row is locked before it is read,
  -- the identity comes from auth.uid(), and time from the database clock.
  def := lower(pg_get_functiondef(fn));
  if position('for update' in def) = 0 or position('auth.uid()' in def) = 0
     or position('clock_timestamp()' in def) = 0 or position('on conflict (user_id, operation) do nothing' in def) = 0 then
    raise exception 'FAIL: consume_ai_generation no longer locks the row / uses auth.uid() / uses the database clock';
  end if;
  raise notice 'PASS: the function locks the (user, operation) row, uses auth.uid() and the database clock';

  select string_agg(c.relname::text, ', ') into bad from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if bad is not null then raise exception 'FAIL: public table without RLS: %', bad; end if;
  raise notice 'PASS: every public base table has RLS enabled';
end $$;

-- 2. Temporary auth users A and B (rolled back at the end) -----------------------
do $$
begin
  insert into auth.users (id, email)
  values (current_setting('p18.a')::uuid, 'p18-test-a-' || current_setting('p18.a') || '@example.invalid'),
         (current_setting('p18.b')::uuid, 'p18-test-b-' || current_setting('p18.b') || '@example.invalid');
exception when others then
  raise exception 'SETUP ERROR: could not create temporary auth users (%). This is not a security result.', sqlerrm;
end $$;

-- Keep every limit check inside one 10-minute window: if a window boundary is less than
-- 15 seconds away, wait for it to pass first (at most 15 seconds).
do $$
declare remaining numeric := 600 - mod(extract(epoch from clock_timestamp()), 600);
begin
  if remaining < 15 then
    perform pg_sleep(remaining + 0.5);
  end if;
end $$;

-- 3. Anonymous (Data API "anon" role) ---------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true),
       set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
declare
  stmt text; ok boolean; err text;
  must_deny text[] := array[
    'select count(*) from public.ai_rate_limits',
    format('insert into public.ai_rate_limits (user_id, operation, window_start, hour_start) values (%L, %L, now(), now())',
           current_setting('p18.a'), 'chat'),
    'update public.ai_rate_limits set window_count = 0',
    'delete from public.ai_rate_limits',
    'select public.consume_ai_generation(''chat'')'];
begin
  foreach stmt in array must_deny loop
    ok := false; err := 'it succeeded';
    begin
      execute stmt;
    exception
      when insufficient_privilege then ok := true;
      when others then err := sqlstate || ' ' || sqlerrm;
    end;
    if not ok then raise exception 'FAIL: anon should be denied [%] but %', stmt, err; end if;
  end loop;
  raise notice 'PASS: anon cannot read or write ai_rate_limits, or run consume_ai_generation()';
end $$;

reset role;

-- 4. Signed-in role without a user id (no "sub" claim) -----------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '', true);
set local role authenticated;

do $$
declare ok boolean := false; err text := 'it succeeded';
begin
  begin
    perform public.consume_ai_generation('chat');
  exception
    when insufficient_privilege then ok := true;
    when others then err := sqlstate || ' ' || sqlerrm;
  end;
  if not ok then raise exception 'FAIL: a call without auth.uid() should be refused but %', err; end if;
  raise notice 'PASS: a call without a user id is refused and records nothing';
end $$;

reset role;

-- 5. Authenticated user A (Data API "authenticated" role, JWT sub = A) -----------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('p18.a'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('p18.a'), true);
set local role authenticated;

do $$
declare
  a uuid := current_setting('p18.a')::uuid;
  b uuid := current_setting('p18.b')::uuid;
  r jsonb; i int; stmt text; ok boolean; err text;
  must_deny text[];
begin
  if (select auth.uid()) is distinct from a then
    raise exception 'SETUP ERROR: auth.uid() does not return test user A; role impersonation is not working';
  end if;

  -- learning: 3 per 10 minutes.
  for i in 1..3 loop
    r := public.consume_ai_generation('learning');
    if r is distinct from '{"allowed": true}'::jsonb then
      raise exception 'FAIL: learning request % of 3 should be allowed, got %', i, r;
    end if;
  end loop;
  raise notice 'PASS: first request and every request up to the limit are allowed (learning 3/3)';

  for i in 1..2 loop
    r := public.consume_ai_generation('learning');
    if (r ->> 'allowed')::boolean is distinct from false
       or (r ->> 'retry_after_seconds')::int not between 1 and 600
       or abs((r ->> 'retry_after_seconds')::int - ceil(extract(epoch from (
            date_bin(interval '10 minutes', clock_timestamp(), timestamptz '1970-01-01 00:00:00+00')
            + interval '10 minutes' - clock_timestamp())))::int) > 1 then
      raise exception 'FAIL: learning request beyond the limit should be denied with the seconds until the window resets, got %', r;
    end if;
  end loop;
  raise notice 'PASS: requests beyond the limit are denied with retry_after_seconds = time left in the 10-minute window';

  r := public.consume_ai_generation('chat');
  if r is distinct from '{"allowed": true}'::jsonb then
    raise exception 'FAIL: chat should be unaffected by the exhausted learning limit, got %', r;
  end if;
  for i in 1..5 loop
    r := public.consume_ai_generation('career_analysis');
    if r is distinct from '{"allowed": true}'::jsonb then
      raise exception 'FAIL: career_analysis request % of 5 should be allowed, got %', i, r;
    end if;
  end loop;
  r := public.consume_ai_generation('career_analysis');
  if (r ->> 'allowed')::boolean is distinct from false then
    raise exception 'FAIL: career_analysis request 6 should be denied, got %', r;
  end if;
  raise notice 'PASS: operations are independent (chat allowed while learning is full; career_analysis 5/5 then denied)';

  foreach stmt in array array[
    'select public.consume_ai_generation(''Learning'')',
    'select public.consume_ai_generation(''learning '')',
    'select public.consume_ai_generation(''unknown'')',
    'select public.consume_ai_generation('''')',
    'select public.consume_ai_generation(null)'] loop
    ok := false; err := 'it succeeded';
    begin
      execute stmt;
    exception
      when invalid_parameter_value then ok := true;
      when others then err := sqlstate || ' ' || sqlerrm;
    end;
    if not ok then raise exception 'FAIL: invalid operation should be rejected [%] but %', stmt, err; end if;
  end loop;
  raise notice 'PASS: unknown, empty, differently cased or NULL operations are rejected';

  -- Direct access, including resetting one's own quota, is refused.
  must_deny := array[
    'select count(*) from public.ai_rate_limits',
    format('select count(*) from public.ai_rate_limits where user_id = %L', a),
    format('update public.ai_rate_limits set window_count = 0, hour_count = 0 where user_id = %L', a),
    format('delete from public.ai_rate_limits where user_id = %L', a),
    format('insert into public.ai_rate_limits (user_id, operation, window_start, hour_start) values (%L, %L, now(), now())', a, 'chat'),
    format('insert into public.ai_rate_limits (user_id, operation, window_start, hour_start) values (%L, %L, now(), now())', b, 'chat'),
    format('update public.ai_rate_limits set window_count = 99 where user_id = %L', b),
    'truncate public.ai_rate_limits'];
  foreach stmt in array must_deny loop
    ok := false; err := 'it succeeded';
    begin
      execute stmt;
    exception
      when insufficient_privilege then ok := true;
      when others then err := sqlstate || ' ' || sqlerrm;
    end;
    if not ok then raise exception 'FAIL: A should be denied [%] but %', stmt, err; end if;
  end loop;
  raise notice 'PASS: A cannot read, reset, delete or insert its own or B''s rate-limit rows, or truncate the table';

  ok := false; err := 'it succeeded';
  begin
    execute format('select public.consume_ai_generation(%L, %L::uuid)', 'chat', b);
  exception
    when undefined_function then ok := true;
    when others then err := sqlstate || ' ' || sqlerrm;
  end;
  if not ok then raise exception 'FAIL: the function accepted a user id argument: %', err; end if;
  raise notice 'PASS: the function has no way to name another user';
end $$;

reset role;

-- 6. As the owner: what A's calls recorded -----------------------------------------
do $$
declare
  a uuid := current_setting('p18.a')::uuid;
  b uuid := current_setting('p18.b')::uuid;
  n bigint;
  row_a public.ai_rate_limits%rowtype;
begin
  select * into row_a from public.ai_rate_limits where user_id = a and operation = 'learning';
  if row_a.window_count <> 3 or row_a.hour_count <> 3 then
    raise exception 'FAIL: denied requests were counted (learning window %, hour %; expected 3 and 3)', row_a.window_count, row_a.hour_count;
  end if;
  if row_a.window_start <> date_bin(interval '10 minutes', row_a.window_start, timestamptz '1970-01-01 00:00:00+00')
     or row_a.hour_start <> date_bin(interval '1 hour', row_a.hour_start, timestamptz '1970-01-01 00:00:00+00')
     or row_a.window_start < row_a.hour_start
     or row_a.window_start > clock_timestamp() then
    raise exception 'FAIL: windows are not aligned to UTC 10-minute / 1-hour boundaries: % / %', row_a.window_start, row_a.hour_start;
  end if;
  raise notice 'PASS: denied requests were not counted (3/3 stored), windows aligned to UTC boundaries';

  select count(*) into n from public.ai_rate_limits where user_id = a and operation = 'chat' and window_count = 1 and hour_count = 1;
  if n <> 1 then raise exception 'FAIL: A''s chat count is wrong'; end if;
  select count(*) into n from public.ai_rate_limits where user_id = a and operation = 'career_analysis' and window_count = 5 and hour_count = 5;
  if n <> 1 then raise exception 'FAIL: A''s career_analysis count is wrong'; end if;
  select count(*) into n from public.ai_rate_limits where user_id = a;
  if n <> 3 then raise exception 'FAIL: A has % rows, expected exactly 3 (one per operation)', n; end if;
  select count(*) into n from public.ai_rate_limits where user_id = b;
  if n <> 0 then raise exception 'FAIL: A''s calls created or changed rows for B'; end if;
  raise notice 'PASS: A''s calls touched only A''s rows (one row per operation)';
end $$;

-- 7. Authenticated user B: A's exhausted limits do not apply to B -----------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('p18.b'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('p18.b'), true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.consume_ai_generation('learning');
  if r is distinct from '{"allowed": true}'::jsonb then
    raise exception 'FAIL: B should be allowed while A is over the learning limit, got %', r;
  end if;
  r := public.consume_ai_generation('career_analysis');
  if r is distinct from '{"allowed": true}'::jsonb then
    raise exception 'FAIL: B should be allowed while A is over the career_analysis limit, got %', r;
  end if;
  raise notice 'PASS: user B is unaffected by user A''s exhausted limits';
end $$;

reset role;

do $$
declare n bigint;
begin
  select count(*) into n from public.ai_rate_limits
  where user_id = current_setting('p18.a')::uuid and operation = 'learning' and window_count = 3;
  if n <> 1 then raise exception 'FAIL: B''s calls changed A''s count'; end if;
  select count(*) into n from public.ai_rate_limits
  where user_id = current_setting('p18.b')::uuid and window_count = 1 and hour_count = 1;
  if n <> 2 then raise exception 'FAIL: B''s own rows are wrong'; end if;
  raise notice 'PASS: B''s calls recorded only for B; A''s count unchanged';
end $$;

-- 8. Window resets, simulated by the owner moving A's windows into the past --------------
-- (the same state the function sees once real time has passed)
update public.ai_rate_limits
   set window_start = window_start - interval '10 minutes'
 where user_id = current_setting('p18.a')::uuid and operation = 'learning';

select set_config('request.jwt.claims', json_build_object('sub', current_setting('p18.a'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('p18.a'), true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.consume_ai_generation('learning');
  if r is distinct from '{"allowed": true}'::jsonb then
    raise exception 'FAIL: a new 10-minute window should allow requests again, got %', r;
  end if;
  raise notice 'PASS: once the 10-minute window has passed, requests are allowed again';
end $$;

reset role;

do $$
declare row_a public.ai_rate_limits%rowtype;
begin
  select * into row_a from public.ai_rate_limits where user_id = current_setting('p18.a')::uuid and operation = 'learning';
  if row_a.window_count <> 1 or row_a.hour_count <> 4 then
    raise exception 'FAIL: new 10-minute window should restart at 1 while the hour keeps counting (got %, %)', row_a.window_count, row_a.hour_count;
  end if;
  raise notice 'PASS: new 10-minute window restarts at 1; the hourly count carries on (4)';
end $$;

-- Hourly ceiling: 10 learning requests this hour, the 10-minute window still has room.
update public.ai_rate_limits
   set window_count = 0, hour_count = 10
 where user_id = current_setting('p18.a')::uuid and operation = 'learning';

set local role authenticated;

do $$
declare r jsonb; expected int;
begin
  r := public.consume_ai_generation('learning');
  expected := ceil(extract(epoch from (
                date_bin(interval '1 hour', clock_timestamp(), timestamptz '1970-01-01 00:00:00+00')
                + interval '1 hour' - clock_timestamp())))::int;
  if (r ->> 'allowed')::boolean is distinct from false
     or (r ->> 'retry_after_seconds')::int not between 1 and 3600
     or abs((r ->> 'retry_after_seconds')::int - expected) > 1 then
    raise exception 'FAIL: the hourly ceiling should deny with the seconds until the hour resets (expected about %), got %', expected, r;
  end if;
  raise notice 'PASS: hourly ceiling denies even with room in the 10-minute window; Retry-After = time left in the hour';
end $$;

reset role;

do $$
declare row_a public.ai_rate_limits%rowtype;
begin
  select * into row_a from public.ai_rate_limits where user_id = current_setting('p18.a')::uuid and operation = 'learning';
  if row_a.window_count <> 0 or row_a.hour_count <> 10 then
    raise exception 'FAIL: the denied request was counted (got %, %)', row_a.window_count, row_a.hour_count;
  end if;
  raise notice 'PASS: the denied request did not increase any count';
end $$;

-- Both windows full: Retry-After is the later of the two resets.
update public.ai_rate_limits
   set window_count = 3, hour_count = 10
 where user_id = current_setting('p18.a')::uuid and operation = 'learning';

set local role authenticated;

do $$
declare r jsonb; hour_left int;
begin
  r := public.consume_ai_generation('learning');
  hour_left := ceil(extract(epoch from (
                 date_bin(interval '1 hour', clock_timestamp(), timestamptz '1970-01-01 00:00:00+00')
                 + interval '1 hour' - clock_timestamp())))::int;
  if (r ->> 'allowed')::boolean is distinct from false or abs((r ->> 'retry_after_seconds')::int - hour_left) > 1 then
    raise exception 'FAIL: with both windows full, Retry-After should be the hourly reset (about %), got %', hour_left, r;
  end if;
  raise notice 'PASS: with both windows full, Retry-After is the later (hourly) reset';
end $$;

reset role;

update public.ai_rate_limits
   set window_start = window_start - interval '1 hour', hour_start = hour_start - interval '1 hour'
 where user_id = current_setting('p18.a')::uuid and operation = 'learning';

set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.consume_ai_generation('learning');
  if r is distinct from '{"allowed": true}'::jsonb then
    raise exception 'FAIL: a new hour should allow requests again, got %', r;
  end if;
  raise notice 'PASS: once the hour has passed, requests are allowed again';
end $$;

reset role;

-- 9. Constraints and integrity, as the table owner --------------------------------
do $$
declare
  a uuid := current_setting('p18.a')::uuid;
  c uuid := current_setting('p18.c')::uuid;
  n bigint; stmt text; ok boolean; err text;
  row_a public.ai_rate_limits%rowtype;
begin
  select * into row_a from public.ai_rate_limits where user_id = a and operation = 'learning';
  if row_a.window_count <> 1 or row_a.hour_count <> 1 then
    raise exception 'FAIL: new hour should restart both counts at 1 (got %, %)', row_a.window_count, row_a.hour_count;
  end if;
  raise notice 'PASS: new hour restarts both counts at 1';

  foreach stmt in array array[
    format('insert into public.ai_rate_limits (user_id, operation, window_start, hour_start) values (%L, %L, now(), now())', a, 'images'),
    format('update public.ai_rate_limits set window_count = -1 where user_id = %L and operation = %L', a, 'chat'),
    format('update public.ai_rate_limits set hour_count = -1 where user_id = %L and operation = %L', a, 'chat')]
  loop
    ok := false; err := 'it succeeded';
    begin
      execute stmt;
    exception
      when check_violation then ok := true;
      when others then err := sqlstate || ' ' || sqlerrm;
    end;
    if not ok then raise exception 'FAIL: check constraint not enforced [%]: %', stmt, err; end if;
  end loop;
  raise notice 'PASS: unknown operations and negative counts are rejected';

  foreach stmt in array array[
    format('insert into public.ai_rate_limits (user_id, operation, window_start, hour_start) values (null, %L, now(), now())', 'chat'),
    format('insert into public.ai_rate_limits (user_id, operation, window_start, hour_start) values (%L, null, now(), now())', c),
    format('update public.ai_rate_limits set window_start = null where user_id = %L and operation = %L', a, 'chat'),
    format('update public.ai_rate_limits set hour_count = null where user_id = %L and operation = %L', a, 'chat')]
  loop
    ok := false; err := 'it succeeded';
    begin
      execute stmt;
    exception
      when not_null_violation then ok := true;
      when others then err := sqlstate || ' ' || sqlerrm;
    end;
    if not ok then raise exception 'FAIL: NOT NULL not enforced [%]: %', stmt, err; end if;
  end loop;
  raise notice 'PASS: NULL values are rejected';

  ok := false; err := 'it succeeded';
  begin
    insert into public.ai_rate_limits (user_id, operation, window_start, hour_start) values (c, 'chat', now(), now());
  exception
    when foreign_key_violation then ok := true;
    when others then err := sqlstate || ' ' || sqlerrm;
  end;
  if not ok then raise exception 'FAIL: a row was accepted for an id with no auth user: %', err; end if;
  raise notice 'PASS: user_id must be an existing auth user';

  ok := false; err := 'it succeeded';
  begin
    insert into public.ai_rate_limits (user_id, operation, window_start, hour_start) values (a, 'chat', now(), now());
  exception
    when unique_violation then ok := true;
    when others then err := sqlstate || ' ' || sqlerrm;
  end;
  if not ok then raise exception 'FAIL: a second row for the same user and operation was accepted: %', err; end if;
  raise notice 'PASS: at most one row per user and operation';

  if (select md5(coalesce(string_agg(r::text, '|' order by r.user_id, r.operation), ''))
      from public.ai_rate_limits r
      where r.user_id not in (a, current_setting('p18.b')::uuid))
     is distinct from current_setting('p18.real_limits') then
    raise exception 'FAIL: real (non-test) rate-limit rows changed during the test';
  end if;
  raise notice 'PASS: real rate-limit rows untouched';

  raise exception 'P1 AI_RATE_LIMITS VERIFICATION PASSED: all checks passed. This error is intentional: it rolls back every temporary test row.';
end $$;

rollback;
