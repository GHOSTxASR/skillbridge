-- =============================================================================
-- P1 verification for public.learning_roadmaps
-- =============================================================================
-- Run the WHOLE script at once in the Supabase SQL Editor (do not run a selection),
-- as the database owner (the editor's default postgres role).
--
-- What it does:
--   * Checks structure: table, columns/types/NOT NULL, primary key, ON DELETE CASCADE
--     foreign key to profiles, size checks, RLS, the exact policy set and privileges.
--   * Creates TEMPORARY test profiles and roadmap rows with random ids, impersonates the
--     anon and authenticated roles exactly as the Supabase Data API does
--     (SET ROLE + request.jwt.claims) and tries every allowed/forbidden action.
--   * Fingerprints real rows before the tests and proves nothing real was changed.
--
-- It NEVER keeps any change: the script always ends in an error, so everything rolls back.
--   Success: the error message starts with  "P1 LEARNING_ROADMAPS VERIFICATION PASSED"
--   Failure: the error message starts with  "FAIL:"  and names the failing check
--   Setup problem (not a security result):  "SETUP ERROR:"
--
-- Not covered (needs a real account): an end-to-end write through the app's Data API
-- client. That is checked when the app starts writing this table.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.learning_roadmaps') is null then
    raise exception 'FAIL: table public.learning_roadmaps does not exist';
  end if;
end $$;

-- 0. Baselines, captured as the table owner (reads only) ------------------------
select set_config('p1.a', gen_random_uuid()::text, true),   -- test user A (owner under test)
       set_config('p1.b', gen_random_uuid()::text, true),   -- test user B (another user)
       set_config('p1.c', gen_random_uuid()::text, true),   -- an id with no profile
       set_config('p1.d', gen_random_uuid()::text, true);   -- test user D (constraint tests)

select set_config('p1.real_roadmaps',
         (select md5(coalesce(string_agg(r::text, '|' order by r.user_id), '')) from public.learning_roadmaps r), true),
       set_config('p1.real_profiles',
         (select md5(coalesce(string_agg(p::text, '|' order by p.id), '')) from public.profiles p), true);

-- 1. Structure ------------------------------------------------------------------
do $$
declare bad text;
begin
  if to_regclass('public.learning_roadmaps') is null then
    raise exception 'FAIL: table public.learning_roadmaps does not exist';
  end if;
  raise notice 'PASS: table exists';

  if not (select relrowsecurity from pg_class where oid = 'public.learning_roadmaps'::regclass) then
    raise exception 'FAIL: RLS is not enabled on learning_roadmaps';
  end if;
  raise notice 'PASS: RLS enabled';

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
    where a.attrelid = 'public.learning_roadmaps'::regclass and a.attnum > 0 and not a.attisdropped
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || col || ' ' || typ || ' not_null=' || not_null as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || col || ' ' || typ || ' not_null=' || not_null from (select * from expected except select * from actual) y)
  ) z;
  if bad is not null then raise exception 'FAIL: columns differ from the intended table: %', bad; end if;
  raise notice 'PASS: columns, types, NOT NULL (all but ai_summary) and generated_at default are as intended';

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_roadmaps'::regclass and contype = 'p'
      and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'public.learning_roadmaps'::regclass and attname = 'user_id')]::int2[]
  ) then
    raise exception 'FAIL: user_id is not the primary key';
  end if;
  raise notice 'PASS: user_id is the primary key';

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_roadmaps'::regclass and contype = 'f'
      and confrelid = 'public.profiles'::regclass and confdeltype = 'c'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (user_id) REFERENCES profiles(id)%'
  ) then
    raise exception 'FAIL: missing FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE';
  end if;
  raise notice 'PASS: user_id references profiles(id) ON DELETE CASCADE';

  with expected(policyname, cmd, roles) as (
    values ('learning_roadmaps_select_own', 'SELECT', 'authenticated'),
           ('learning_roadmaps_insert_own', 'INSERT', 'authenticated'),
           ('learning_roadmaps_update_own', 'UPDATE', 'authenticated')
  ),
  actual as (
    select policyname::text as policyname, cmd::text as cmd,
           (select string_agg(r::text, ',' order by r::text) from unnest(roles) r) as roles
    from pg_policies
    where schemaname = 'public' and tablename = 'learning_roadmaps' and permissive = 'PERMISSIVE'
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || policyname || ' ' || cmd || ' to ' || roles as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || policyname from (select * from expected except select * from actual) y)
    union all
    (select 'restrictive ' || policyname from pg_policies
     where schemaname = 'public' and tablename = 'learning_roadmaps' and permissive <> 'PERMISSIVE')
  ) z;
  if bad is not null then raise exception 'FAIL: policy set differs from the intended model: %', bad; end if;

  select string_agg(policyname, ', ') into bad from pg_policies
  where schemaname = 'public' and tablename = 'learning_roadmaps'
    and coalesce(qual, '') !~ 'auth\.uid\(\)' and coalesce(with_check, '') !~ 'auth\.uid\(\)';
  if bad is not null then raise exception 'FAIL: policy without an auth.uid() ownership rule: %', bad; end if;
  raise notice 'PASS: exactly 3 owner policies (select / insert / update), no delete policy';

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
  if bad is not null then raise exception 'FAIL: privileges differ from the intended model: %', bad; end if;

  if has_table_privilege('anon', 'public.learning_roadmaps', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.learning_roadmaps', 'DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception 'FAIL: anon or authenticated holds an effective privilege it should not';
  end if;
  raise notice 'PASS: authenticated has only SELECT/INSERT/UPDATE; anon and PUBLIC have nothing';

  if exists (select 1 from pg_roles where rolname = 'service_role')
     and not has_table_privilege('service_role', 'public.learning_roadmaps', 'SELECT, INSERT, UPDATE, DELETE') then
    raise exception 'FAIL: service_role lost its privileges on learning_roadmaps';
  end if;
  raise notice 'PASS: service_role privileges preserved';

  select string_agg(c.relname::text, ', ') into bad from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if bad is not null then raise exception 'FAIL: public table without RLS: %', bad; end if;
  raise notice 'PASS: every public base table has RLS enabled';
end $$;

-- 2. Temporary test data (rolled back at the end) --------------------------------
-- Profiles use the same columns the app writes at onboarding; B also gets a roadmap.
do $$
begin
  insert into public.profiles
    (id, name, target_role, experience_level, job_readiness, skills_mastered, skill_gaps, learning_progress)
  values
    (current_setting('p1.a')::uuid, 'P1 Test A', 'Tester', 'Beginner', 0, 0, 0, 0),
    (current_setting('p1.b')::uuid, 'P1 Test B', 'Tester', 'Beginner', 0, 0, 0, 0),
    (current_setting('p1.d')::uuid, 'P1 Test D', 'Tester', 'Beginner', 0, 0, 0, 0);

  insert into public.learning_roadmaps (user_id, input_hash, roadmap, ai_summary, model, prompt_version)
  values (current_setting('p1.b')::uuid, 'hash-b', '[{"skill":"B"}]', 'B summary', 'test-model', 'test-v1');
exception when others then
  raise exception 'SETUP ERROR: could not create temporary test data (%). This is not a security result.', sqlerrm;
end $$;

-- 3. Anonymous (Data API "anon" role) ---------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true),
       set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
declare
  stmt text; ok boolean; err text;
  must_deny text[] := array[
    'select count(*) from public.learning_roadmaps',
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, %L, %L, %L, %L)',
           current_setting('p1.a'), 'anon', '[]', 'm', 'v'),
    format('update public.learning_roadmaps set input_hash = %L where user_id = %L', 'anon', current_setting('p1.b')),
    format('delete from public.learning_roadmaps where user_id = %L', current_setting('p1.b'))];
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
  raise notice 'PASS: anon SELECT, INSERT, UPDATE and DELETE denied';
end $$;

reset role;

-- 4. Authenticated owner A (Data API "authenticated" role, JWT sub = A) -----------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('p1.a'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('p1.a'), true);
set local role authenticated;

do $$
declare
  a uuid := current_setting('p1.a')::uuid;
  b uuid := current_setting('p1.b')::uuid;
  c uuid := current_setting('p1.c')::uuid;
  n bigint; stmt text; ok boolean; err text;
  must_deny text[];
begin
  if (select auth.uid()) is distinct from a then
    raise exception 'SETUP ERROR: auth.uid() does not return test user A; role impersonation is not working';
  end if;

  begin
    insert into public.learning_roadmaps (user_id, input_hash, roadmap, ai_summary, model, prompt_version)
    values (a, 'hash-a1', '[{"skill":"A1"}]', 'A summary', 'test-model', 'test-v1');
  exception when others then
    raise exception 'FAIL: owner cannot insert own roadmap: %', sqlerrm;
  end;
  raise notice 'PASS: owner can INSERT own row';

  select count(*) into n from public.learning_roadmaps where user_id = a;
  if n <> 1 then raise exception 'FAIL: owner cannot select own row (% rows)', n; end if;
  raise notice 'PASS: owner can SELECT own row';

  select count(*) into n from public.learning_roadmaps;
  if n <> 1 then raise exception 'FAIL: owner sees % rows, expected only its own', n; end if;
  select count(*) into n from public.learning_roadmaps where user_id = b;
  if n <> 0 then raise exception 'FAIL: owner can select another user''s roadmap'; end if;
  raise notice 'PASS: owner cannot SELECT another user''s row (sees only its own)';

  update public.learning_roadmaps
     set input_hash = 'hash-a2', roadmap = '[{"skill":"A2"}]', generated_at = now()
   where user_id = a;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: owner cannot update own row (% rows)', n; end if;
  raise notice 'PASS: owner can UPDATE own row';

  begin
    insert into public.learning_roadmaps (user_id, input_hash, roadmap, ai_summary, model, prompt_version)
    values (a, 'hash-a3', '[{"skill":"A3"}]', 'A summary 3', 'test-model', 'test-v1')
    on conflict (user_id) do update
      set input_hash = excluded.input_hash, roadmap = excluded.roadmap,
          ai_summary = excluded.ai_summary, generated_at = now();
  exception when others then
    raise exception 'FAIL: owner cannot upsert own row: %', sqlerrm;
  end;
  select count(*) into n from public.learning_roadmaps where user_id = a and input_hash = 'hash-a3';
  if n <> 1 then raise exception 'FAIL: owner upsert did not take effect'; end if;
  raise notice 'PASS: owner can UPSERT own row (insert ... on conflict do update)';

  update public.learning_roadmaps set input_hash = 'hijacked' where user_id = b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: owner updated another user''s roadmap'; end if;
  raise notice 'PASS: owner cannot UPDATE another user''s row';

  must_deny := array[
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, %L, %L, %L, %L)',
           b, 'spoof', '[]', 'm', 'v'),
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, %L, %L, %L, %L)',
           c, 'spoof', '[]', 'm', 'v'),
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, %L, %L, %L, %L) '
           || 'on conflict (user_id) do update set input_hash = excluded.input_hash', b, 'spoof', '[]', 'm', 'v'),
    format('update public.learning_roadmaps set user_id = %L where user_id = %L', c, a),
    format('delete from public.learning_roadmaps where user_id = %L', a),
    format('delete from public.learning_roadmaps where user_id = %L', b),
    'truncate public.learning_roadmaps'];
  foreach stmt in array must_deny loop
    ok := false; err := 'it succeeded';
    begin
      execute stmt;
    exception
      when insufficient_privilege then ok := true;
      when others then err := sqlstate || ' ' || sqlerrm;
    end;
    if not ok then raise exception 'FAIL: owner should be denied [%] but %', stmt, err; end if;
  end loop;
  raise notice 'PASS: owner cannot INSERT/UPSERT for another user, re-point own row, DELETE any row, or TRUNCATE';
end $$;

reset role;

-- 5. Constraints and integrity, as the table owner --------------------------------
do $$
declare
  a uuid := current_setting('p1.a')::uuid;
  b uuid := current_setting('p1.b')::uuid;
  c uuid := current_setting('p1.c')::uuid;
  d uuid := current_setting('p1.d')::uuid;
  n bigint; stmt text; ok boolean; err text;
  gen timestamptz;
begin
  foreach stmt in array array[
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (null, %L, %L, %L, %L)', 'h', '[]', 'm', 'v'),
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, null, %L, %L, %L)', d, '[]', 'm', 'v'),
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, %L, null, %L, %L)', d, 'h', 'm', 'v'),
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, %L, %L, null, %L)', d, 'h', '[]', 'v'),
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, %L, %L, %L, null)', d, 'h', '[]', 'm'),
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, generated_at, prompt_version) values (%L, %L, %L, %L, null, %L)', d, 'h', '[]', 'm', 'v')]
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
  raise notice 'PASS: user_id, input_hash, roadmap, model, generated_at and prompt_version reject NULL';

  insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version)
  values (d, 'hash-d', '[]', 'test-model', 'test-v1')
  returning generated_at into gen;
  if gen is null then raise exception 'FAIL: generated_at default not applied'; end if;
  select count(*) into n from public.learning_roadmaps where user_id = d and ai_summary is null;
  if n <> 1 then raise exception 'FAIL: ai_summary should accept NULL'; end if;
  raise notice 'PASS: generated_at defaults to now(); ai_summary is optional';

  ok := false; err := 'it succeeded';
  begin
    insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version)
    values (c, 'h', '[]', 'm', 'v');
  exception
    when foreign_key_violation then ok := true;
    when others then err := sqlstate || ' ' || sqlerrm;
  end;
  if not ok then raise exception 'FAIL: roadmap accepted for a user with no profile: %', err; end if;
  raise notice 'PASS: user_id must reference an existing profile';

  foreach stmt in array array[
    format('update public.learning_roadmaps set roadmap = to_jsonb(repeat(%L, 100001)) where user_id = %L', 'x', d),
    format('update public.learning_roadmaps set ai_summary = repeat(%L, 10001) where user_id = %L', 'x', d)]
  loop
    ok := false; err := 'it succeeded';
    begin
      execute stmt;
    exception
      when check_violation then ok := true;
      when others then err := sqlstate || ' ' || sqlerrm;
    end;
    if not ok then raise exception 'FAIL: size limit not enforced [%]: %', left(stmt, 80), err; end if;
  end loop;
  raise notice 'PASS: roadmap (100,000 bytes) and ai_summary (10,000 chars) size limits enforced';

  select count(*) into n from public.learning_roadmaps where user_id = b and input_hash = 'hash-b';
  if n <> 1 then raise exception 'FAIL: B''s roadmap was modified or deleted'; end if;
  raise notice 'PASS: other user''s row untouched';

  delete from public.profiles where id = a;
  select count(*) into n from public.learning_roadmaps where user_id = a;
  if n <> 0 then raise exception 'FAIL: deleting the profile did not cascade to its roadmap'; end if;
  raise notice 'PASS: deleting a profile deletes its roadmap (ON DELETE CASCADE)';

  if (select md5(coalesce(string_agg(r::text, '|' order by r.user_id), ''))
      from public.learning_roadmaps r where r.user_id not in (a, b, d))
     is distinct from current_setting('p1.real_roadmaps') then
    raise exception 'FAIL: real (non-test) roadmap rows changed during the test';
  end if;
  if (select md5(coalesce(string_agg(p::text, '|' order by p.id), ''))
      from public.profiles p where p.id not in (a, b, d))
     is distinct from current_setting('p1.real_profiles') then
    raise exception 'FAIL: real (non-test) profile rows changed during the test';
  end if;
  raise notice 'PASS: real profiles and roadmaps untouched';

  raise exception 'P1 LEARNING_ROADMAPS VERIFICATION PASSED: all checks passed. This error is intentional: it rolls back every temporary test row.';
end $$;

rollback;
