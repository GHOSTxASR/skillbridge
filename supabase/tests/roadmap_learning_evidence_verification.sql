-- =============================================================================
-- Verification for trusted learning-roadmap versions and roadmap step completion
-- (learning_roadmap_versions, learning_roadmap_version_steps,
--  create_learning_roadmap_version, complete_roadmap_learning_step,
--  skill_evidence_roadmap_completion_key)
-- =============================================================================
-- Run the WHOLE script at once in the Supabase SQL Editor (do not run a selection), as
-- the database owner (the editor's default postgres role). Use "Run without RLS": the
-- script manages roles itself.
--
-- What it does:
--   * Structure: both tables (RLS, exact policies, exact privileges for anon /
--     authenticated / service_role / PUBLIC, constraints, foreign keys, immutability
--     triggers), the three functions (owner, SECURITY DEFINER, empty search_path, exact
--     EXECUTE grants, no API role able to alter them), and the exact completion index.
--   * Creates TEMPORARY profiles, catalog skills and versions with random ids and acts as
--     anon, two authenticated users and service_role exactly as the Supabase Data API does
--     (SET ROLE + request.jwt.claims), trying every allowed and forbidden action.
--   * Proves the display cache (learning_roadmaps) never becomes evidence, that versions
--     cannot be changed by anyone, that completion is idempotent and never lowers progress.
--   * Fingerprints real rows before the tests and proves nothing real was changed.
--
-- It NEVER keeps any change: the script always ends in an error, so everything rolls back.
--   Success: the error message starts with  "ROADMAP LEARNING EVIDENCE VERIFICATION PASSED"
--   Failure: the error message starts with  "FAIL:"  and names the failing check
--   Setup problem (not a security result):  "SETUP ERROR:"
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.learning_roadmap_versions') is null or to_regclass('public.learning_roadmap_version_steps') is null
     or to_regprocedure('public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)') is null
     or to_regprocedure('public.complete_roadmap_learning_step(uuid,integer)') is null then
    raise exception 'FAIL: the roadmap learning evidence migration is not applied';
  end if;
end $$;

-- Runs a statement that must fail with one SQLSTATE (as whichever role is active).
create function pg_temp.expect_error(p_stmt text, p_state text, p_label text)
returns void language plpgsql as $$
declare got text;
begin
  begin
    execute p_stmt;
  exception when others then
    got := sqlstate;
    if got = p_state then return; end if;
    raise exception 'FAIL: % - expected SQLSTATE % but got % (%)', p_label, p_state, got, sqlerrm;
  end;
  raise exception 'FAIL: % - expected SQLSTATE % but it succeeded', p_label, p_state;
end $$;
grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated, service_role;

-- 0. Baselines and test ids ------------------------------------------------------
select set_config('rle.a', gen_random_uuid()::text, true),   -- user A (owner under test)
       set_config('rle.b', gen_random_uuid()::text, true),   -- user B (another user)
       set_config('rle.c', gen_random_uuid()::text, true),   -- user C (profile deletion cascade)
       set_config('rle.sx', gen_random_uuid()::text, true),  -- test catalog skills
       set_config('rle.sy', gen_random_uuid()::text, true),
       set_config('rle.sp', gen_random_uuid()::text, true),  -- A already practicing
       set_config('rle.sa', gen_random_uuid()::text, true),  -- A already assessed
       set_config('rle.sv', gen_random_uuid()::text, true),  -- A already proven
       set_config('rle.asa', gen_random_uuid()::text, true); -- A's assessment

select set_config('rle.real_progress',
         (select md5(coalesce(string_agg(r::text, '|' order by r.user_id, r.skill_id), '')) from public.skill_progress r), true),
       set_config('rle.real_evidence',
         (select md5(coalesce(string_agg(r::text, '|' order by r.id), '')) from public.skill_evidence r), true),
       set_config('rle.real_roadmaps',
         (select md5(coalesce(string_agg(r::text, '|' order by r.user_id), '')) from public.learning_roadmaps r), true),
       set_config('rle.real_versions',
         (select md5(coalesce(string_agg(r::text, '|' order by r.id), '')) from public.learning_roadmap_versions r), true),
       set_config('rle.real_steps',
         (select md5(coalesce(string_agg(r::text, '|' order by r.version_id, r.step_order), '')) from public.learning_roadmap_version_steps r), true);

-- 1. Structure --------------------------------------------------------------------
do $$
declare
  t text; f text; bad text;
  create_fn   constant text := 'public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)';
  complete_fn constant text := 'public.complete_roadmap_learning_step(uuid,integer)';
  trigger_fn  constant text := 'public.learning_roadmap_versions_immutable()';
begin
  foreach t in array array['learning_roadmap_versions', 'learning_roadmap_version_steps'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception 'FAIL: RLS is off on %', t;
    end if;
    if (select count(*) from pg_policies where schemaname = 'public' and tablename = t) <> 1
       or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd = 'SELECT'
                      and roles = '{authenticated}' and permissive = 'PERMISSIVE'
                      and regexp_replace(coalesce(qual, ''), '\s', '', 'g') in ('((SELECTauth.uid()ASuid)=user_id)', '(auth.uid()=user_id)')) then
      raise exception 'FAIL: % must have exactly one owner SELECT policy (auth.uid() = user_id)', t;
    end if;
    select string_agg(case when a.grantee = 0 then 'PUBLIC' else r.rolname end || ' ' || a.privilege_type, ', ') into bad
    from pg_class c cross join lateral aclexplode(c.relacl) a left join pg_roles r on r.oid = a.grantee
    where c.oid = format('public.%I', t)::regclass and (a.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role'))
      and not (r.rolname = 'authenticated' and a.privilege_type = 'SELECT');
    if bad is not null then raise exception 'FAIL: unexpected privileges on %: %', t, bad; end if;
    if not has_table_privilege('authenticated', format('public.%I', t), 'SELECT') then
      raise exception 'FAIL: authenticated cannot read own rows of %', t;
    end if;
    if (select count(*) from pg_trigger where tgrelid = format('public.%I', t)::regclass and not tgisinternal
        and tgfoid = trigger_fn::regprocedure and tgenabled = 'O') <> 2 then
      raise exception 'FAIL: % must have its two enabled immutability triggers (row UPDATE/DELETE, statement TRUNCATE)', t;
    end if;
  end loop;
  raise notice 'PASS: both tables: RLS on, one owner SELECT policy, only authenticated SELECT granted, immutability triggers enabled';

  if not exists (select 1 from pg_constraint where conrelid = 'public.learning_roadmap_versions'::regclass and contype = 'f'
                 and confrelid = 'public.profiles'::regclass and confdeltype = 'c')
     or not exists (select 1 from pg_constraint where conrelid = 'public.learning_roadmap_version_steps'::regclass and contype = 'f'
                    and confrelid = 'public.learning_roadmap_versions'::regclass and confdeltype = 'c' and array_length(conkey, 1) = 2)
     or not exists (select 1 from pg_constraint where conrelid = 'public.learning_roadmap_version_steps'::regclass and contype = 'f'
                    and confrelid = 'public.skills'::regclass and confdeltype = 'a')
     or not exists (select 1 from pg_constraint where conname = 'learning_roadmap_versions_user_number_key' and contype = 'u')
     or not exists (select 1 from pg_constraint where conname = 'learning_roadmap_versions_id_user_key' and contype = 'u')
     or not exists (select 1 from pg_constraint where conname = 'learning_roadmap_version_steps_pkey' and contype = 'p') then
    raise exception 'FAIL: keys and foreign keys of the version tables differ from the reviewed design';
  end if;
  raise notice 'PASS: versions cascade from profiles, steps from their version (same owner), skills are referenced; version numbers unique per user';

  foreach f in array array[create_fn, complete_fn, trigger_fn] loop
    if not exists (select 1 from pg_proc where oid = f::regprocedure and proconfig = array['search_path=""']) then
      raise exception 'FAIL: % must pin an empty search_path', f;
    end if;
    if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid = f::regprocedure and a.grantee = 0) then
      raise exception 'FAIL: PUBLIC may execute %', f;
    end if;
    if exists (select 1 from pg_proc p join pg_roles o on o.oid = p.proowner where p.oid = f::regprocedure
               and (pg_has_role('anon', o.oid, 'MEMBER') or pg_has_role('authenticated', o.oid, 'MEMBER')
                    or pg_has_role('service_role', o.oid, 'MEMBER'))) then
      raise exception 'FAIL: an API role belongs to the owner of % and could alter it', f;
    end if;
    if exists (select 1 from pg_proc p join pg_roles o on o.oid = p.proowner where p.oid = f::regprocedure
               and o.rolname in ('anon', 'authenticated', 'service_role', 'authenticator')) then
      raise exception 'FAIL: % is owned by an API role', f;
    end if;
  end loop;
  if not (select prosecdef from pg_proc where oid = create_fn::regprocedure)
     or not (select prosecdef from pg_proc where oid = complete_fn::regprocedure) then
    raise exception 'FAIL: create/complete functions must be SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc p join pg_roles o on o.oid = p.proowner where p.oid = create_fn::regprocedure
                 and has_table_privilege(o.oid, 'public.learning_roadmap_versions', 'INSERT')
                 and has_table_privilege(o.oid, 'public.learning_roadmap_version_steps', 'INSERT'))
     or not exists (select 1 from pg_proc p join pg_roles o on o.oid = p.proowner where p.oid = complete_fn::regprocedure
                    and has_table_privilege(o.oid, 'public.skill_evidence', 'INSERT')
                    and has_table_privilege(o.oid, 'public.learning_roadmap_versions', 'SELECT')) then
    raise exception 'FAIL: the function owners lack the privileges the functions need';
  end if;
  if not has_function_privilege('service_role', create_fn, 'EXECUTE')
     or has_function_privilege('authenticated', create_fn, 'EXECUTE') or has_function_privilege('anon', create_fn, 'EXECUTE')
     or not has_function_privilege('authenticated', complete_fn, 'EXECUTE')
     or has_function_privilege('anon', complete_fn, 'EXECUTE') or has_function_privilege('service_role', complete_fn, 'EXECUTE') then
    raise exception 'FAIL: EXECUTE must be: create = service_role only, complete = authenticated only';
  end if;
  if exists (select 1 from pg_proc p, unnest(p.proargnames) n where p.oid = complete_fn::regprocedure and (n ilike '%user%' or n ilike '%skill%')) then
    raise exception 'FAIL: complete_roadmap_learning_step must take no user or skill argument';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'complete_roadmap_learning_step'
             and oid <> complete_fn::regprocedure) then
    raise exception 'FAIL: another overload of complete_roadmap_learning_step exists';
  end if;
  raise notice 'PASS: functions: SECURITY DEFINER, empty search_path, owned by a non-API role no API role belongs to, owners hold the needed privileges, exact EXECUTE grants, no skill/user argument';

  if not exists (
    select 1 from pg_index i
    where i.indexrelid = to_regclass('public.skill_evidence_roadmap_completion_key')
      and i.indrelid = 'public.skill_evidence'::regclass
      and i.indisunique and i.indisvalid and i.indimmediate and i.indnatts = 4 and i.indnkeyatts = 4
      and pg_get_indexdef(i.indexrelid) = $def$CREATE UNIQUE INDEX skill_evidence_roadmap_completion_key ON public.skill_evidence USING btree (user_id, skill_id, ((metadata ->> 'roadmap_version_id'::text)), ((metadata ->> 'roadmap_step'::text))) WHERE ((evidence_type = 'learning'::text) AND (retracted_at IS NULL) AND ((metadata ->> 'source'::text) = 'roadmap'::text))$def$
  ) then
    raise exception 'FAIL: skill_evidence_roadmap_completion_key is missing or not exactly the reviewed definition';
  end if;
  if exists (select 1 from pg_index i where i.indrelid = 'public.skill_evidence'::regclass and i.indisunique
             and i.indexrelid <> to_regclass('public.skill_evidence_roadmap_completion_key')
             and pg_get_indexdef(i.indexrelid) ilike '%roadmap%') then
    raise exception 'FAIL: another unique index on skill_evidence involves roadmap fields';
  end if;
  raise notice 'PASS: the completion index is exactly the reviewed definition and the only roadmap unique index';
end $$;

-- 2. Temporary test data, as the owner (rolled back at the end) ---------------------
do $$
declare
  a uuid := current_setting('rle.a')::uuid; b uuid := current_setting('rle.b')::uuid; c uuid := current_setting('rle.c')::uuid;
begin
  insert into public.profiles (id, name, target_role, experience_level, job_readiness, skills_mastered, skill_gaps, learning_progress)
  values (a, 'RLE Test A', 'Software Engineer', 'Beginner', 0, 0, 0, 0),
         (b, 'RLE Test B', 'Data Scientist', 'Beginner', 0, 0, 0, 0),
         (c, 'RLE Test C', 'Tester', 'Beginner', 0, 0, 0, 0);
  insert into public.skills (id, name)
  values (current_setting('rle.sx')::uuid, 'RLE Skill X ' || current_setting('rle.sx')),
         (current_setting('rle.sy')::uuid, 'RLE Skill Y ' || current_setting('rle.sy')),
         (current_setting('rle.sp')::uuid, 'RLE Skill P ' || current_setting('rle.sp')),
         (current_setting('rle.sa')::uuid, 'RLE Skill A ' || current_setting('rle.sa')),
         (current_setting('rle.sv')::uuid, 'RLE Skill V ' || current_setting('rle.sv'));
  insert into public.assessments (id, user_id, target_role) values (current_setting('rle.asa')::uuid, a, 'Software Engineer');
  insert into public.skill_evidence (user_id, skill_id, evidence_type, title, score, assessment_id)
  values (a, current_setting('rle.sa')::uuid, 'assessment', 'RLE assessment', 70, current_setting('rle.asa')::uuid);
  insert into public.skill_progress (user_id, skill_id, status, confidence_score, confidence_updated_at)
  values (a, current_setting('rle.sv')::uuid, 'proven', 90, now());
  -- A's display cache, which the tests will tamper with.
  insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version)
  values (a, 'rle-cache', '[{"order":1,"phase":"Foundation","skill":"RLE Step Skill","reason":"Why step one matters."}]', 'rle', 'rle');
exception when others then
  raise exception 'SETUP ERROR: could not create temporary test data (%). This is not a security result.', sqlerrm;
end $$;

-- 3. service_role: creates versions, cannot write the tables directly ----------------------
do $$
begin
  execute 'set local role service_role';
exception when others then
  raise exception 'SETUP ERROR: this session cannot act as service_role (%). This is not a security result.', sqlerrm;
end $$;
select set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.sub', '', true);

do $$
declare
  a text := current_setting('rle.a'); b text := current_setting('rle.b'); c text := current_setting('rle.c');
  steps_a jsonb; v1 uuid; vb uuid; vc uuid; n integer;
begin
  steps_a := jsonb_build_array(
    jsonb_build_object('order', 1, 'phase', 'Foundation', 'skill', 'RLE Step Skill', 'skillId', current_setting('rle.sx'), 'reason', 'Why step one matters.'),
    jsonb_build_object('order', 2, 'phase', 'Core', 'skill', 'HTML & CSS', 'skillId', null, 'reason', 'Unmatched compound.'),
    jsonb_build_object('order', 3, 'phase', 'Core', 'skill', 'RLE Step Skill', 'skillId', current_setting('rle.sx'), 'reason', 'The same skill again.'),
    jsonb_build_object('order', 4, 'phase', 'Core', 'skill', 'Practicing Skill', 'skillId', current_setting('rle.sp')),
    jsonb_build_object('order', 5, 'phase', 'Core', 'skill', 'Assessed Skill', 'skillId', current_setting('rle.sa')),
    jsonb_build_object('order', 6, 'phase', 'Core', 'skill', 'Proven Skill', 'skillId', current_setting('rle.sv')),
    jsonb_build_object('order', 7, 'skill', 'Skill Y', 'skillId', current_setting('rle.sy')));
  v1 := public.create_learning_roadmap_version(a::uuid, 'rle-hash-a', 'rle-model', 'rle-v1', now(), steps_a);
  vb := public.create_learning_roadmap_version(b::uuid, 'rle-hash-b', 'rle-model', 'rle-v1', now(),
          jsonb_build_array(jsonb_build_object('order', 1, 'skill', 'B Skill', 'skillId', current_setting('rle.sx'))));
  vc := public.create_learning_roadmap_version(c::uuid, 'rle-hash-c', 'rle-model', 'rle-v1', now(),
          jsonb_build_array(jsonb_build_object('order', 1, 'skill', 'C Skill', 'skillId', current_setting('rle.sx'))));
  perform set_config('rle.v1', v1::text, true);
  perform set_config('rle.vb', vb::text, true);
  perform set_config('rle.vc', vc::text, true);

  -- Every malformed input is refused (no partial version: counted as the owner below).
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v',
    '[{"order":1,"skill":"x"},{"order":3,"skill":"y"}]'), '22023', 'step order gap');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v',
    '[{"order":1,"skill":"x"},{"order":1,"skill":"y"}]'), '22023', 'duplicate step order');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v',
    '[{"order":2,"skill":"x"},{"order":1,"skill":"y"}]'), '22023', 'reordered steps');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v',
    jsonb_build_array(jsonb_build_object('order', 1, 'skill', 'x', 'phase', repeat('p', 201)))), '22023', 'oversized phase');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v',
    jsonb_build_array(jsonb_build_object('order', 1, 'skill', repeat('s', 201)))), '22023', 'oversized skill text');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v',
    jsonb_build_array(jsonb_build_object('order', 1, 'skill', 'x', 'reason', repeat('r', 2001)))), '22023', 'oversized reason');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v',
    jsonb_build_array(jsonb_build_object('order', 1, 'skill', 'x', 'skillId', gen_random_uuid()))), '22023', 'unknown skill id');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v',
    '[{"order":1,"skill":"x","skillId":"not-a-uuid"}]'), '22023', 'malformed skill id');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v',
    '[{"order":1,"skill":"x","version_number":9}]'), '22023', 'unexpected step field');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v', '[]'), '22023', 'no steps');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v', '{"order":1}'), '22023', 'steps not an array');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v',
    (select jsonb_agg(jsonb_build_object('order', g, 'skill', 'x')) from generate_series(1, 51) g)), '22023', '51 steps');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, '', 'm', 'v', '[{"order":1,"skill":"x"}]'), '22023', 'empty input hash');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now() + interval ''1 day'', %L)', a, 'h', 'm', 'v', '[{"order":1,"skill":"x"}]'), '22023', 'future generated_at');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', gen_random_uuid(), 'h', 'm', 'v', '[{"order":1,"skill":"x"}]'), '23503', 'unknown profile');
  raise notice 'PASS: service_role creates versions; gaps, duplicates, reordering, oversized fields, unknown/malformed skills, extra fields, bad sizes and unknown profiles are refused with no partial version';

  -- service_role holds no table privileges: it cannot write (or even read) the tables directly.
  perform pg_temp.expect_error(format('insert into public.learning_roadmap_versions (user_id, version_number, input_hash, model, prompt_version, generated_at, step_count) values (%L, 99, %L, %L, %L, now(), 1)', a, 'h', 'm', 'v'), '42501', 'service_role direct insert');
  perform pg_temp.expect_error(format('update public.learning_roadmap_versions set model = %L where id = %L', 'x', v1), '42501', 'service_role update');
  perform pg_temp.expect_error(format('delete from public.learning_roadmap_versions where id = %L', v1), '42501', 'service_role delete');
  perform pg_temp.expect_error('truncate public.learning_roadmap_versions cascade', '42501', 'service_role truncate');
  perform pg_temp.expect_error(format('update public.learning_roadmap_version_steps set skill_id = %L', current_setting('rle.sy')), '42501', 'service_role step update');
  perform pg_temp.expect_error(format('select public.complete_roadmap_learning_step(%L, 1)', v1), '42501', 'service_role completing a step');
  raise notice 'PASS: service_role cannot insert, update, delete or truncate versions directly, and cannot complete steps';
end $$;

reset role;

-- As the owner: exactly the three good versions exist; the refused calls left nothing behind.
do $$
begin
  if (select count(*) from public.learning_roadmap_versions
      where user_id in (current_setting('rle.a')::uuid, current_setting('rle.b')::uuid, current_setting('rle.c')::uuid)) <> 3
     or (select count(*) from public.learning_roadmap_version_steps where version_id = current_setting('rle.v1')::uuid) <> 7
     or (select step_count from public.learning_roadmap_versions where id = current_setting('rle.v1')::uuid) <> 7 then
    raise exception 'FAIL: a refused version left rows behind, or a version is incomplete';
  end if;
  raise notice 'PASS: refused calls left no partial version; the created version has all 7 steps';
end $$;

-- 4. Anonymous (Data API "anon" role) ---------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
declare v1 text := current_setting('rle.v1');
begin
  perform pg_temp.expect_error('select count(*) from public.learning_roadmap_versions', '42501', 'anon read versions');
  perform pg_temp.expect_error('select count(*) from public.learning_roadmap_version_steps', '42501', 'anon read steps');
  perform pg_temp.expect_error(format('update public.learning_roadmap_versions set model = %L', 'x'), '42501', 'anon update');
  perform pg_temp.expect_error('delete from public.learning_roadmap_versions', '42501', 'anon delete');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', current_setting('rle.a'), 'h', 'm', 'v', '[{"order":1,"skill":"x"}]'), '42501', 'anon create');
  perform pg_temp.expect_error(format('select public.complete_roadmap_learning_step(%L, 1)', v1), '42501', 'anon complete');
  raise notice 'PASS: anon cannot read, write, create or complete anything';
end $$;

reset role;

-- 5. User A (authenticated) ---------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rle.a'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('rle.a'), true);
set local role authenticated;

do $$
declare
  a text := current_setting('rle.a'); v1 uuid := current_setting('rle.v1')::uuid; vb uuid := current_setting('rle.vb')::uuid;
  sx uuid := current_setting('rle.sx')::uuid; sy uuid := current_setting('rle.sy')::uuid;
  sp uuid := current_setting('rle.sp')::uuid; sa uuid := current_setting('rle.sa')::uuid; sv uuid := current_setting('rle.sv')::uuid;
  r jsonb; r2 jsonb; first_id uuid; n integer;
begin
  -- Reads: own rows only.
  if (select count(*) from public.learning_roadmap_versions) <> 1 or (select count(*) from public.learning_roadmap_version_steps) <> 7
     or exists (select 1 from public.learning_roadmap_versions where id = vb) then
    raise exception 'FAIL: A must see exactly A''s own version and steps';
  end if;
  raise notice 'PASS: A reads only A''s version and steps';

  -- Writes and privileged calls: all refused.
  perform pg_temp.expect_error(format('insert into public.learning_roadmap_versions (user_id, version_number, input_hash, model, prompt_version, generated_at, step_count) values (%L, 2, %L, %L, %L, now(), 1)', a, 'fake', 'm', 'v'), '42501', 'A inserts a fake version');
  perform pg_temp.expect_error(format('insert into public.learning_roadmap_version_steps (version_id, user_id, step_order, skill_text, skill_id) values (%L, %L, 8, %L, %L)', v1, a, 'Fake', sy), '42501', 'A inserts a fake step');
  perform pg_temp.expect_error(format('update public.learning_roadmap_version_steps set skill_id = %L where version_id = %L', sy, v1), '42501', 'A rewrites a step skill');
  perform pg_temp.expect_error(format('update public.learning_roadmap_versions set version_number = 99 where id = %L', v1), '42501', 'A rewrites the version number');
  perform pg_temp.expect_error(format('delete from public.learning_roadmap_versions where id = %L', v1), '42501', 'A deletes the version');
  perform pg_temp.expect_error('truncate public.learning_roadmap_version_steps', '42501', 'A truncates steps');
  perform pg_temp.expect_error(format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', a, 'h', 'm', 'v', '[{"order":1,"skill":"x"}]'), '42501', 'A calls the create function');
  perform pg_temp.expect_error('alter function public.complete_roadmap_learning_step(uuid, integer) security invoker', '42501', 'A alters the completion function');
  perform pg_temp.expect_error('alter function public.create_learning_roadmap_version(uuid, text, text, text, timestamptz, jsonb) owner to authenticated', '42501', 'A takes over the create function');
  perform pg_temp.expect_error(format('select public.complete_roadmap_learning_step(%L, 1, %L)', v1, sy), '42883', 'A passes a skill id to completion');
  raise notice 'PASS: A cannot insert, rewrite, delete or truncate versions/steps, cannot create versions, cannot alter the functions, cannot pass a skill id';

  -- The display cache is A's to edit, and it never matters for evidence.
  update public.learning_roadmaps set roadmap = '[{"order":1,"phase":"Mastered","skill":"Skill Y","reason":"Verified expert."}]',
         input_hash = 'forged', generated_at = '2030-01-01' where user_id = a::uuid;

  r := public.complete_roadmap_learning_step(v1, 1);
  if (r ->> 'created')::boolean is not true
     or (r -> 'evidence' ->> 'skill_id')::uuid <> sx
     or r -> 'evidence' ->> 'title' <> 'Foundation: RLE Step Skill'
     or r -> 'evidence' ->> 'description' <> 'Completed learning step 1 of your SkillBridge roadmap. Why step one matters.'
     or r -> 'evidence' -> 'metadata' ->> 'source' <> 'roadmap'
     or r -> 'evidence' -> 'metadata' ->> 'roadmap_version_id' <> v1::text
     or (r -> 'evidence' -> 'metadata' ->> 'roadmap_step')::int <> 1
     or r -> 'evidence' ->> 'score' is not null then
    raise exception 'FAIL: evidence not built from the trusted version: %', r -> 'evidence';
  end if;
  if r -> 'progress' ->> 'status' <> 'learning' or r -> 'progress' ->> 'confidence_score' is not null
     or r -> 'progress' ->> 'learning_progress' is not null then
    raise exception 'FAIL: progress after completion: %', r -> 'progress';
  end if;
  first_id := (r -> 'evidence' ->> 'id')::uuid;
  raise notice 'PASS: with the cache fully rewritten, completion still records the trusted skill, title and description; progress -> learning, no confidence';

  -- Idempotent.
  r2 := public.complete_roadmap_learning_step(v1, 1);
  r2 := public.complete_roadmap_learning_step(v1, 1);
  select count(*) into n from public.skill_evidence where skill_id = sx and retracted_at is null;
  if (r2 ->> 'created')::boolean or (r2 -> 'evidence' ->> 'id')::uuid <> first_id or n <> 1 then
    raise exception 'FAIL: repeated completion was not idempotent';
  end if;
  r := public.complete_roadmap_learning_step(v1, 3);
  if (r ->> 'created')::boolean is not true or (select count(*) from public.skill_evidence where skill_id = sx and retracted_at is null) <> 2 then
    raise exception 'FAIL: step 3 (same skill) is not its own completion';
  end if;
  raise notice 'PASS: repeats return the existing row; another step with the same skill is its own completion';

  -- Unmatched, unknown, foreign.
  select count(*) into n from public.skill_evidence;
  perform pg_temp.expect_error(format('select public.complete_roadmap_learning_step(%L, 2)', v1), 'SB422', 'unmatched compound skill');
  perform pg_temp.expect_error(format('select public.complete_roadmap_learning_step(%L, 9)', v1), 'P0002', 'step not in the version');
  perform pg_temp.expect_error(format('select public.complete_roadmap_learning_step(%L, 1)', gen_random_uuid()), 'P0002', 'unknown version');
  perform pg_temp.expect_error(format('select public.complete_roadmap_learning_step(%L, 1)', vb), 'P0002', 'B''s version');
  perform pg_temp.expect_error(format('select public.complete_roadmap_learning_step(%L, 0)', v1), '22023', 'step 0');
  perform pg_temp.expect_error('select public.complete_roadmap_learning_step(null, 1)', '22023', 'no version');
  if (select count(*) from public.skill_evidence) <> n then raise exception 'FAIL: a refused completion wrote evidence'; end if;
  raise notice 'PASS: unmatched skill -> SB422; unknown step/version and another user''s version -> the same P0002; nothing written';

  -- No direct evidence writes; the general function cannot forge a roadmap completion.
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, metadata) values (%L, %L, %L, %L, %L)',
    a, sy, 'learning', 'x', jsonb_build_object('source', 'roadmap', 'roadmap_version_id', v1, 'roadmap_step', 7)), '42501', 'direct evidence insert');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sy, 'learning', 'x',
    jsonb_build_object('source', 'roadmap', 'roadmap_version_id', v1, 'roadmap_step', 7)), '22023', 'add_skill_evidence with roadmap completion keys');
  raise notice 'PASS: no direct evidence writes; add_skill_evidence cannot write roadmap completion metadata';

  -- Progress is never lowered.
  perform public.set_skill_progress_status(sp, 'practicing');
  if public.complete_roadmap_learning_step(v1, 4) -> 'progress' ->> 'status' <> 'practicing' then raise exception 'FAIL: practicing lowered'; end if;
  if public.complete_roadmap_learning_step(v1, 5) -> 'progress' ->> 'status' <> 'assessed' then raise exception 'FAIL: assessed lowered'; end if;
  r := public.complete_roadmap_learning_step(v1, 6);
  if r -> 'progress' ->> 'status' <> 'proven' or (r -> 'progress' ->> 'confidence_score')::int <> 90 then raise exception 'FAIL: proven changed'; end if;
  perform public.set_skill_progress_status(sy, 'learning');
  if public.complete_roadmap_learning_step(v1, 7) -> 'progress' ->> 'status' <> 'learning' then raise exception 'FAIL: learning changed'; end if;
  raise notice 'PASS: learning, practicing, assessed and proven are never lowered; proven keeps its confidence';

  -- Retraction keeps history; completing again is a new row.
  perform public.retract_skill_evidence(first_id);
  r := public.complete_roadmap_learning_step(v1, 1);
  if (r ->> 'created')::boolean is not true or (r -> 'evidence' ->> 'id')::uuid = first_id
     or not exists (select 1 from public.skill_evidence where id = first_id and retracted_at is not null) then
    raise exception 'FAIL: completing after a retraction did not create a new row, or the old row changed';
  end if;
  raise notice 'PASS: a retracted completion stays history; completing again creates one new active row';

  -- Shadowing attempt: temporary objects named like the real ones must not be used.
  begin
    execute 'create temp table learning_roadmap_versions (id uuid, user_id uuid, version_number int)';
    execute 'create temp table skills (id uuid, name text)';
  exception when others then null;  -- temp objects may not be allowed here; then there is nothing to shadow
  end;
  r := public.complete_roadmap_learning_step(v1, 7);
  if (r -> 'evidence' ->> 'skill_id')::uuid <> sy then raise exception 'FAIL: temporary objects changed name resolution'; end if;
  raise notice 'PASS: temporary objects named like the real tables do not affect the functions (empty search_path, qualified names)';
end $$;

reset role;

-- 6. A newer version makes the older one un-completable -----------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  perform set_config('rle.v2', public.create_learning_roadmap_version(current_setting('rle.a')::uuid, 'rle-hash-a2', 'rle-model', 'rle-v1', now(),
    jsonb_build_array(jsonb_build_object('order', 1, 'skill', 'Skill Y', 'skillId', current_setting('rle.sy'))))::text, true);
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('rle.a'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('rle.a'), true);
set local role authenticated;
do $$
declare n integer;
begin
  select count(*) into n from public.skill_evidence;
  perform pg_temp.expect_error(format('select public.complete_roadmap_learning_step(%L, 3)', current_setting('rle.v1')), 'SB409', 'completing an older version');
  if (select count(*) from public.skill_evidence) <> n then raise exception 'FAIL: completing an old version wrote evidence'; end if;
  if (public.complete_roadmap_learning_step(current_setting('rle.v2')::uuid, 1) ->> 'created')::boolean is not true then
    raise exception 'FAIL: the latest version cannot be completed';
  end if;
  if (select array_agg(version_number order by version_number) from public.learning_roadmap_versions) <> array[1, 2] then
    raise exception 'FAIL: version numbers are not 1, 2 for A';
  end if;
  raise notice 'PASS: an older version -> SB409 (enforced by the database), the latest version completes; version numbers 1, 2';
end $$;
reset role;

-- 7. User B cannot touch A's versions or evidence -------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rle.b'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('rle.b'), true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.learning_roadmap_versions where user_id <> current_setting('rle.b')::uuid)
     or exists (select 1 from public.learning_roadmap_version_steps where user_id <> current_setting('rle.b')::uuid)
     or exists (select 1 from public.skill_evidence where user_id <> current_setting('rle.b')::uuid) then
    raise exception 'FAIL: B can see A''s versions, steps or evidence';
  end if;
  perform pg_temp.expect_error(format('select public.complete_roadmap_learning_step(%L, 1)', current_setting('rle.v2')), 'P0002', 'B completing A''s version');
  raise notice 'PASS: B sees none of A''s versions, steps or evidence and cannot complete A''s version';
end $$;
reset role;

-- 8. Owner-level immutability, the unique keys, the profile cascade, and nothing real changed -
do $$
begin
  perform pg_temp.expect_error(format('update public.learning_roadmap_versions set model = %L where id = %L', 'x', current_setting('rle.v1')), '55000', 'owner update (trigger)');
  perform pg_temp.expect_error(format('delete from public.learning_roadmap_versions where id = %L', current_setting('rle.v1')), '55000', 'owner delete (trigger)');
  perform pg_temp.expect_error(format('delete from public.learning_roadmap_version_steps where version_id = %L', current_setting('rle.v1')), '55000', 'owner step delete (trigger)');
  perform pg_temp.expect_error('truncate public.learning_roadmap_version_steps', '55000', 'owner truncate (trigger)');
  raise notice 'PASS: even the owner role cannot update, delete or truncate versions (triggers)';

  perform pg_temp.expect_error(format('insert into public.learning_roadmap_versions (user_id, version_number, input_hash, model, prompt_version, generated_at, step_count) values (%L, 1, %L, %L, %L, now(), 1)',
    current_setting('rle.a'), 'h', 'm', 'v'), '23505', 'duplicate version number');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, metadata) select user_id, skill_id, %L, %L, metadata from public.skill_evidence where user_id = %L and retracted_at is null and metadata ->> %L = %L limit 1',
    'learning', 'duplicate', current_setting('rle.a'), 'source', 'roadmap'), '23505', 'second active completion');
  raise notice 'PASS: the database refuses a duplicate version number and a second active completion';

  delete from public.profiles where id = current_setting('rle.c')::uuid;
  if exists (select 1 from public.learning_roadmap_versions where id = current_setting('rle.vc')::uuid)
     or exists (select 1 from public.learning_roadmap_version_steps where version_id = current_setting('rle.vc')::uuid) then
    raise exception 'FAIL: deleting a profile did not cascade to its versions and steps';
  end if;
  raise notice 'PASS: deleting a profile still cascades to its versions and steps';

  if (select md5(coalesce(string_agg(r::text, '|' order by r.user_id, r.skill_id), '')) from public.skill_progress r
      where r.user_id not in (current_setting('rle.a')::uuid, current_setting('rle.b')::uuid)) <> current_setting('rle.real_progress')
     or (select md5(coalesce(string_agg(r::text, '|' order by r.id), '')) from public.skill_evidence r
         where r.user_id not in (current_setting('rle.a')::uuid, current_setting('rle.b')::uuid)) <> current_setting('rle.real_evidence')
     or (select md5(coalesce(string_agg(r::text, '|' order by r.user_id), '')) from public.learning_roadmaps r
         where r.user_id not in (current_setting('rle.a')::uuid, current_setting('rle.b')::uuid)) <> current_setting('rle.real_roadmaps')
     or (select md5(coalesce(string_agg(r::text, '|' order by r.id), '')) from public.learning_roadmap_versions r
         where r.user_id not in (current_setting('rle.a')::uuid, current_setting('rle.b')::uuid)) <> current_setting('rle.real_versions')
     or (select md5(coalesce(string_agg(r::text, '|' order by r.version_id, r.step_order), '')) from public.learning_roadmap_version_steps r
         where r.user_id not in (current_setting('rle.a')::uuid, current_setting('rle.b')::uuid)) <> current_setting('rle.real_steps') then
    raise exception 'FAIL: real rows changed during the tests';
  end if;
  raise notice 'PASS: real progress, evidence, roadmaps and versions unchanged';

  raise exception 'ROADMAP LEARNING EVIDENCE VERIFICATION PASSED: all checks passed. This error is intentional: it rolls back every temporary test row.';
end $$;
