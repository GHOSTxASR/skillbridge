-- P0 RLS verification for public.profiles (plus a scan for any public table without RLS).
--
-- Run as the database owner (Supabase SQL editor or psql). It creates two throwaway users
-- inside one transaction, impersonates the anon and authenticated roles the same way
-- PostgREST does (SET ROLE + request.jwt.claims), and asserts every rule.
--
-- It never leaves data behind: the script ENDS WITH AN INTENTIONAL ERROR whose message
-- starts with "P0 RLS: ALL TESTS PASSED", which aborts and rolls back the transaction.
-- Any other error message means a test failed; the message names the failing check.

begin;

select
  set_config('test.a', gen_random_uuid()::text, true),
  set_config('test.b', gen_random_uuid()::text, true),
  set_config('test.c', gen_random_uuid()::text, true);

insert into auth.users (id, email, aud, role) values
  (current_setting('test.a')::uuid, 'rls-test-a@example.invalid', 'authenticated', 'authenticated'),
  (current_setting('test.b')::uuid, 'rls-test-b@example.invalid', 'authenticated', 'authenticated');

-- Same columns the app writes at onboarding (app/setup-profile/page.tsx).
insert into public.profiles
  (id, name, target_role, experience_level, job_readiness, skills_mastered, skill_gaps, learning_progress)
values
  (current_setting('test.a')::uuid, 'RLS Test A', 'Tester', 'Beginner', 0, 0, 0, 0),
  (current_setting('test.b')::uuid, 'RLS Test B', 'Tester', 'Beginner', 0, 0, 0, 0)
on conflict (id) do update set name = excluded.name;

-- ---------------------------------------------------------------- anonymous
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare n int;
begin
  begin
    select count(*) into n from public.profiles;
    if n <> 0 then raise exception 'FAIL anon SELECT returned % rows', n; end if;
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS anon SELECT blocked';

  begin
    insert into public.profiles (id, name, target_role, experience_level, job_readiness, skills_mastered, skill_gaps, learning_progress)
    values (current_setting('test.c')::uuid, 'anon', 'x', 'x', 0, 0, 0, 0);
    raise exception 'FAIL anon INSERT succeeded';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS anon INSERT blocked';

  begin
    update public.profiles set name = 'anon-update' where id = current_setting('test.b')::uuid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL anon UPDATE changed % rows', n; end if;
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS anon UPDATE blocked';

  begin
    delete from public.profiles where id = current_setting('test.b')::uuid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL anon DELETE removed % rows', n; end if;
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS anon DELETE blocked';
end $$;

reset role;

-- ------------------------------------------------------- authenticated user A
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.a'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare n int;
declare a uuid := current_setting('test.a')::uuid;
declare b uuid := current_setting('test.b')::uuid;
declare c uuid := current_setting('test.c')::uuid;
begin
  select count(*) into n from public.profiles where id = a;
  if n <> 1 then raise exception 'FAIL A cannot SELECT own profile (% rows)', n; end if;
  raise notice 'PASS A SELECT own profile';

  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL A sees % profiles; expected only its own', n; end if;
  raise notice 'PASS A sees only its own profile';

  select count(*) into n from public.profiles where id = b;
  if n <> 0 then raise exception 'FAIL A can SELECT B'; end if;
  raise notice 'PASS A SELECT B blocked';

  update public.profiles set name = 'RLS Test A updated' where id = a;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL A cannot UPDATE own profile (% rows)', n; end if;
  raise notice 'PASS A UPDATE own profile';

  update public.profiles set name = 'hijacked' where id = b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL A UPDATE on B changed % rows', n; end if;
  raise notice 'PASS A UPDATE B blocked';

  delete from public.profiles where id = b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL A DELETE on B removed % rows', n; end if;
  raise notice 'PASS A DELETE B blocked';

  delete from public.profiles where id = a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL A DELETE own removed % rows (no delete policy expected)', n; end if;
  raise notice 'PASS A DELETE own blocked (profiles are not deletable via API)';

  begin
    insert into public.profiles (id, name, target_role, experience_level, job_readiness, skills_mastered, skill_gaps, learning_progress)
    values (c, 'spoof', 'x', 'x', 0, 0, 0, 0);
    raise exception 'FAIL A INSERT with another id succeeded';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS A INSERT spoofed id blocked';

  begin
    update public.profiles set id = c where id = a;
    raise exception 'FAIL A re-pointed own row to another id';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS A UPDATE id spoof blocked';
end $$;

reset role;

-- ------------------------------------------------------------ owner checks
do $$
declare n int;
declare t text;
begin
  select count(*) into n from public.profiles
  where id = current_setting('test.b')::uuid and name = 'RLS Test B';
  if n <> 1 then raise exception 'FAIL B profile was modified or deleted'; end if;

  select count(*) into n from public.profiles
  where id = current_setting('test.a')::uuid and name = 'RLS Test A updated';
  if n <> 1 then raise exception 'FAIL A own update did not persist'; end if;
  raise notice 'PASS data integrity: B untouched, A updated';

  for t in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    raise exception 'FAIL public table without RLS: %', t;
  end loop;
  raise notice 'PASS every public table has RLS enabled';

  raise exception 'P0 RLS: ALL TESTS PASSED (this error intentionally rolls back the test data)';
end $$;

rollback;
