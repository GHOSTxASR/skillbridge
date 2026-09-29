-- =============================================================================
-- Verification for public.skill_progress and public.skill_evidence
-- =============================================================================
-- Run the WHOLE script at once in the Supabase SQL Editor (do not run a selection),
-- as the database owner (the editor's default postgres role).
--
-- What it does:
--   * Checks structure: columns, constraints, foreign keys and their delete rules, RLS,
--     the exact policy set (owner SELECT only), privileges, the four owner functions
--     (SECURITY DEFINER, empty search_path, authenticated-only), the internal helpers
--     (not callable by API roles), the progress trigger, the catalog name index.
--   * Creates TEMPORARY profiles, catalog skills, assessments, a roadmap and evidence
--     with random ids, impersonates anon and authenticated exactly as the Supabase Data
--     API does (SET ROLE + request.jwt.claims) and tries every allowed/forbidden action:
--     cross-user reads and writes, id enumeration, spoofed owners, direct table writes,
--     confidence/score/status authority, validation of every input.
--   * Fingerprints real rows before the tests and proves nothing real was changed.
--
-- It NEVER keeps any change: the script always ends in an error, so everything rolls back.
--   Success: the error message starts with  "SKILL PROGRESS EVIDENCE VERIFICATION PASSED"
--   Failure: the error message starts with  "FAIL:"  and names the failing check
--   Setup problem (not a security result):  "SETUP ERROR:"
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.skill_progress') is null or to_regclass('public.skill_evidence') is null then
    raise exception 'FAIL: public.skill_progress / public.skill_evidence do not exist';
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
grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated;

-- 0. Baselines and test ids ------------------------------------------------------
select set_config('spe.a', gen_random_uuid()::text, true),    -- user A (owner under test)
       set_config('spe.b', gen_random_uuid()::text, true),    -- user B (another user)
       set_config('spe.c', gen_random_uuid()::text, true),    -- signed in, no profile
       set_config('spe.d', gen_random_uuid()::text, true),    -- user D (evidence limit)
       set_config('spe.sx', gen_random_uuid()::text, true),   -- test catalog skills
       set_config('spe.sy', gen_random_uuid()::text, true),
       set_config('spe.sz', gen_random_uuid()::text, true),
       set_config('spe.snone', gen_random_uuid()::text, true), -- not in the catalog
       set_config('spe.asa', gen_random_uuid()::text, true),  -- A's assessment
       set_config('spe.asb', gen_random_uuid()::text, true),  -- B's assessment
       set_config('spe.ev_b', gen_random_uuid()::text, true), -- B's project evidence
       set_config('spe.ev_a_assess', gen_random_uuid()::text, true); -- A's assessment evidence

select set_config('spe.real_progress',
         (select md5(coalesce(string_agg(r::text, '|' order by r.user_id, r.skill_id), '')) from public.skill_progress r), true),
       set_config('spe.real_evidence',
         (select md5(coalesce(string_agg(r::text, '|' order by r.id), '')) from public.skill_evidence r), true),
       set_config('spe.real_profiles',
         (select md5(coalesce(string_agg(p::text, '|' order by p.id), '')) from public.profiles p), true),
       set_config('spe.real_skills',
         (select md5(coalesce(string_agg(s::text, '|' order by s.id), '')) from public.skills s), true),
       set_config('spe.real_assessments',
         (select md5(coalesce(string_agg(s::text, '|' order by s.id), '')) from public.assessments s), true);

-- 1. Structure --------------------------------------------------------------------
do $$
declare
  bad text;
  f text;
  owner_fns constant text[] := array[
    'public.set_skill_progress_status(uuid,text)',
    'public.add_skill_evidence(uuid[],text,text,text,text,jsonb,timestamp with time zone)',
    'public.update_skill_evidence(uuid,text,text,text,jsonb)',
    'public.retract_skill_evidence(uuid)'];
  internal_fns constant text[] := array[
    'public.skill_evidence_url_ok(text)',
    'public.skill_evidence_apply_progress()',
    'public.skill_evidence_check_metadata(uuid,text,jsonb)'];
begin
  if not (select relrowsecurity from pg_class where oid = 'public.skill_progress'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.skill_evidence'::regclass) then
    raise exception 'FAIL: RLS is not enabled on skill_progress / skill_evidence';
  end if;
  raise notice 'PASS: both tables exist with RLS enabled';

  if (select count(*) from pg_attribute where attrelid = 'public.skill_evidence'::regclass and attnum > 0 and not attisdropped) <> 15
     or (select count(*) from pg_attribute where attrelid = 'public.skill_progress'::regclass and attnum > 0 and not attisdropped) <> 13 then
    raise exception 'FAIL: unexpected column count (skill_evidence 15, skill_progress 13 expected)';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.skill_evidence'::regclass
             and attname in ('user_id', 'skill_id', 'evidence_type', 'title', 'metadata', 'observed_at', 'created_at', 'updated_at')
             and not attnotnull)
     or exists (select 1 from pg_attribute where attrelid = 'public.skill_progress'::regclass
             and attname in ('user_id', 'skill_id', 'status', 'first_observed_at', 'last_activity_at', 'created_at', 'updated_at')
             and not attnotnull)
     or exists (select 1 from pg_attribute where attrelid = 'public.skill_progress'::regclass
             and attname in ('confidence_score', 'learning_progress', 'practice_progress') and attnotnull) then
    raise exception 'FAIL: NOT NULL rules differ from the intended tables';
  end if;
  raise notice 'PASS: columns and NOT NULL rules as intended (confidence and progress are nullable: unknown until measured)';

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.skill_progress'::regclass and contype = 'p'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.skill_progress'::regclass and attname = 'user_id'),
                         (select attnum from pg_attribute where attrelid = 'public.skill_progress'::regclass and attname = 'skill_id')]::int2[]
  ) then
    raise exception 'FAIL: skill_progress primary key is not (user_id, skill_id)';
  end if;
  if exists (
    select 1 from pg_index i
    where i.indrelid = 'public.skill_evidence'::regclass and i.indisunique
      and i.indkey::int2[] @> array[(select attnum from pg_attribute where attrelid = 'public.skill_evidence'::regclass and attname = 'user_id'),
                                    (select attnum from pg_attribute where attrelid = 'public.skill_evidence'::regclass and attname = 'skill_id')]::int2[]
      and not (i.indkey::int2[] @> array[(select attnum from pg_attribute where attrelid = 'public.skill_evidence'::regclass and attname = 'id')]::int2[])
      -- Reviewed exception (roadmap learning evidence migration), exempt ONLY when every
      -- property matches exactly: this name, unique, valid, immediate, 4 key columns and no
      -- INCLUDE columns, and the complete definition text (columns, expressions, method,
      -- predicate, NULLS handling). It allows one ACTIVE roadmap completion per (user, skill,
      -- trusted roadmap version, step); a user still has many evidence records per skill. A copy
      -- under another name, or any change to the definition, is NOT exempt.
      and not (i.indexrelid = to_regclass('public.skill_evidence_roadmap_completion_key')
               and i.indisvalid and i.indimmediate and i.indnatts = 4 and i.indnkeyatts = 4
               and pg_get_indexdef(i.indexrelid) = $def$CREATE UNIQUE INDEX skill_evidence_roadmap_completion_key ON public.skill_evidence USING btree (user_id, skill_id, ((metadata ->> 'roadmap_version_id'::text)), ((metadata ->> 'roadmap_step'::text))) WHERE ((evidence_type = 'learning'::text) AND (retracted_at IS NULL) AND ((metadata ->> 'source'::text) = 'roadmap'::text))$def$)
  ) then
    raise exception 'FAIL: skill_evidence must not be unique per (user, skill): a user has many evidence records per skill';
  end if;
  raise notice 'PASS: one progress row per (user, skill); many evidence rows per (user, skill)';

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
  if bad is not null then raise exception 'FAIL: foreign keys differ from the intended model: %', bad; end if;
  raise notice 'PASS: user -> profiles ON DELETE CASCADE; skill, assessment and latest-assessment links refuse deletion';

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'skills_name_lower_key'
                 and indexdef ilike '%unique%lower(name)%')
     or not exists (select 1 from pg_constraint where conrelid = 'public.assessments'::regclass
                    and conname = 'assessments_id_user_id_key' and contype = 'u') then
    raise exception 'FAIL: skills case-insensitive name index or assessments (id, user_id) key is missing';
  end if;
  raise notice 'PASS: catalog names unique ignoring case; assessments carry an (id, user_id) key';

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
  if bad is not null then raise exception 'FAIL: policy set differs from the intended model: %', bad; end if;

  select string_agg(policyname, ', ') into bad from pg_policies
  where schemaname = 'public' and tablename in ('skill_evidence', 'skill_progress')
    and regexp_replace(coalesce(qual, ''), '\s', '', 'g')
        not in ('((SELECTauth.uid()ASuid)=user_id)', '(auth.uid()=user_id)',
                '(user_id=(SELECTauth.uid()ASuid))', '(user_id=auth.uid())');
  if bad is not null then raise exception 'FAIL: policy is not exactly auth.uid() = user_id: %', bad; end if;
  raise notice 'PASS: exactly one policy per table: owner SELECT, auth.uid() = user_id; no insert/update/delete policy';

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
  if bad is not null then raise exception 'FAIL: privileges differ from the intended model: %', bad; end if;
  if has_table_privilege('anon', 'public.skill_evidence', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('anon', 'public.skill_progress', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.skill_evidence', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.skill_progress', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception 'FAIL: anon or authenticated holds an effective privilege it should not';
  end if;
  raise notice 'PASS: authenticated may only SELECT; anon and PUBLIC have nothing';

  if exists (select 1 from pg_roles where rolname = 'service_role')
     and (not has_table_privilege('service_role', 'public.skill_evidence', 'SELECT, INSERT, UPDATE, DELETE')
          or not has_table_privilege('service_role', 'public.skill_progress', 'SELECT, INSERT, UPDATE, DELETE')) then
    raise exception 'FAIL: service_role lost its privileges on the new tables';
  end if;
  raise notice 'PASS: service_role privileges preserved';

  foreach f in array owner_fns loop
    if not exists (select 1 from pg_proc where oid = f::regprocedure and prosecdef
                   and provolatile = 'v' and proconfig @> array['search_path=""']) then
      raise exception 'FAIL: % must be a volatile SECURITY DEFINER function with an empty search_path', f;
    end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE')
       or has_function_privilege('anon', f, 'EXECUTE')
       or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                  where p.oid = f::regprocedure and a.grantee = 0) then
      raise exception 'FAIL: % must be executable by authenticated only (not anon or PUBLIC)', f;
    end if;
    if exists (select 1 from pg_proc p, unnest(p.proargnames) n where p.oid = f::regprocedure and n ilike '%user%') then
      raise exception 'FAIL: % takes a user parameter; the owner must come from auth.uid() only', f;
    end if;
  end loop;
  raise notice 'PASS: 4 owner functions: SECURITY DEFINER, empty search_path, authenticated only, no user parameter';

  foreach f in array internal_fns loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                  where p.oid = f::regprocedure and a.grantee = 0) then
      raise exception 'FAIL: internal function % is callable by anon, authenticated or PUBLIC', f;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.skill_evidence'::regclass
                 and tgname = 'skill_evidence_apply_progress' and not tgisinternal) then
    raise exception 'FAIL: progress trigger missing';
  end if;
  raise notice 'PASS: internal helpers not callable through the API; progress trigger present';

  select string_agg(c.relname::text, ', ') into bad from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if bad is not null then raise exception 'FAIL: public table without RLS: %', bad; end if;
  raise notice 'PASS: every public base table has RLS enabled';
end $$;

-- 2. Temporary test data, as the owner (rolled back at the end) ---------------------
do $$
declare
  a uuid := current_setting('spe.a')::uuid;  b uuid := current_setting('spe.b')::uuid;
  d uuid := current_setting('spe.d')::uuid;
begin
  insert into public.profiles (id, name, target_role, experience_level, job_readiness, skills_mastered, skill_gaps, learning_progress)
  values (a, 'SPE Test A', 'Software Engineer', 'Beginner', 0, 0, 0, 0),
         (b, 'SPE Test B', 'Data Scientist', 'Advanced', 0, 0, 0, 0),
         (d, 'SPE Test D', 'Tester', 'Beginner', 0, 0, 0, 0);

  insert into public.skills (id, name)
  values (current_setting('spe.sx')::uuid, 'SPE Test Skill X ' || current_setting('spe.sx')),
         (current_setting('spe.sy')::uuid, 'SPE Test Skill Y ' || current_setting('spe.sy')),
         (current_setting('spe.sz')::uuid, 'SPE Test Skill Z ' || current_setting('spe.sz'));

  insert into public.assessments (id, user_id, target_role)
  values (current_setting('spe.asa')::uuid, a, 'Software Engineer'),
         (current_setting('spe.asb')::uuid, b, 'Data Scientist');

  insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version)
  values (a, 'spe-hash-a', '[{"order":1,"skill":"SPE Roadmap Skill"},{"order":2,"skill":"Second Step"}]', 'spe-test', 'spe-test');

  -- B's evidence, and A's measured assessment result on skill Y (only the server may write these).
  insert into public.skill_evidence (id, user_id, skill_id, evidence_type, title, source_url)
  values (current_setting('spe.ev_b')::uuid, b, current_setting('spe.sx')::uuid, 'project', 'SPE B project', 'https://example.com/b');
  insert into public.skill_evidence (user_id, skill_id, evidence_type, title, score, assessment_id)
  values (b, current_setting('spe.sx')::uuid, 'assessment', 'SPE B assessment', 81, current_setting('spe.asb')::uuid);
  insert into public.skill_evidence (id, user_id, skill_id, evidence_type, title, score, assessment_id, metadata)
  values (current_setting('spe.ev_a_assess')::uuid, a, current_setting('spe.sy')::uuid, 'assessment', 'SPE A assessment',
          72, current_setting('spe.asa')::uuid, '{"max_score": 100}');
exception when others then
  raise exception 'SETUP ERROR: could not create temporary test data (%). This is not a security result.', sqlerrm;
end $$;

-- 3. Anonymous (Data API "anon" role) ---------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true),
       set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
declare
  a text := current_setting('spe.a'); sx text := current_setting('spe.sx'); evb text := current_setting('spe.ev_b');
begin
  perform pg_temp.expect_error('select count(*) from public.skill_progress', '42501', 'anon SELECT skill_progress');
  perform pg_temp.expect_error('select count(*) from public.skill_evidence', '42501', 'anon SELECT skill_evidence');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title) values (%L, %L, %L, %L)', a, sx, 'project', 'x'), '42501', 'anon INSERT evidence');
  perform pg_temp.expect_error(format('insert into public.skill_progress (user_id, skill_id) values (%L, %L)', a, sx), '42501', 'anon INSERT progress');
  perform pg_temp.expect_error('update public.skill_evidence set title = ''x''', '42501', 'anon UPDATE evidence');
  perform pg_temp.expect_error('update public.skill_progress set confidence_score = 99', '42501', 'anon UPDATE progress');
  perform pg_temp.expect_error('delete from public.skill_evidence', '42501', 'anon DELETE evidence');
  perform pg_temp.expect_error('delete from public.skill_progress', '42501', 'anon DELETE progress');
  perform pg_temp.expect_error(format('select public.set_skill_progress_status(%L, %L)', sx, 'learning'), '42501', 'anon set_skill_progress_status');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L)', sx, 'project', 'x'), '42501', 'anon add_skill_evidence');
  perform pg_temp.expect_error(format('select public.update_skill_evidence(%L, %L)', evb, 'x'), '42501', 'anon update_skill_evidence');
  perform pg_temp.expect_error(format('select public.retract_skill_evidence(%L)', evb), '42501', 'anon retract_skill_evidence');
  perform pg_temp.expect_error('select public.skill_evidence_url_ok(''https://x.y'')', '42501', 'anon internal helper');
  raise notice 'PASS: anon cannot select, insert, update or delete either table, nor call any function';
end $$;

reset role;

-- 4. Authenticated user A -------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('spe.a'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('spe.a'), true);
set local role authenticated;

do $$
declare
  a uuid := current_setting('spe.a')::uuid;  b uuid := current_setting('spe.b')::uuid;
  sx uuid := current_setting('spe.sx')::uuid; sy uuid := current_setting('spe.sy')::uuid;
  sz uuid := current_setting('spe.sz')::uuid; snone uuid := current_setting('spe.snone')::uuid;
  evb uuid := current_setting('spe.ev_b')::uuid;
  r jsonb; n bigint; st text; g uuid; ev uuid;
begin
  if (select auth.uid()) is distinct from a then
    raise exception 'SETUP ERROR: auth.uid() does not return test user A; role impersonation is not working';
  end if;

  -- Reads: own rows only.
  select count(*) into n from public.skill_evidence;
  if n <> 1 then raise exception 'FAIL: A sees % evidence rows, expected only its own 1', n; end if;
  select count(*) into n from public.skill_evidence where user_id = b or id = evb;
  if n <> 0 then raise exception 'FAIL: A can read B''s evidence'; end if;
  select count(*) into n from public.skill_progress where user_id = b;
  if n <> 0 then raise exception 'FAIL: A can read B''s progress'; end if;
  select status into st from public.skill_progress where user_id = a and skill_id = sy;
  if st is distinct from 'assessed' then raise exception 'FAIL: assessment evidence did not mark A''s skill Y assessed (%)', st; end if;
  raise notice 'PASS: A reads only its own progress and evidence; B''s rows and ids are invisible';

  -- Progress status: user-declared states only.
  r := public.set_skill_progress_status(sx, 'learning');
  if r ->> 'status' <> 'learning' or (r ->> 'user_id')::uuid <> a then raise exception 'FAIL: set status learning returned %', r; end if;
  r := public.set_skill_progress_status(sx, 'practicing');
  r := public.set_skill_progress_status(sx, 'not_started');
  r := public.set_skill_progress_status(sx, 'not_started');
  select count(*) into n from public.skill_progress where user_id = a and skill_id = sx;
  if n <> 1 or r ->> 'status' <> 'not_started' then raise exception 'FAIL: repeated status updates should keep one row (% rows)', n; end if;
  if (r ->> 'confidence_score') is not null then raise exception 'FAIL: confidence was set without evidence'; end if;
  raise notice 'PASS: A can set own status to learning / practicing / not_started; one row per skill; confidence stays unset';

  perform pg_temp.expect_error(format('select public.set_skill_progress_status(%L, %L)', sx, 'assessed'), '22023', 'self-assign assessed');
  perform pg_temp.expect_error(format('select public.set_skill_progress_status(%L, %L)', sx, 'proven'), '22023', 'self-assign proven');
  perform pg_temp.expect_error(format('select public.set_skill_progress_status(%L, %L)', sx, 'expert'), '22023', 'unknown status');
  perform pg_temp.expect_error(format('select public.set_skill_progress_status(%L, null)', sx), '22023', 'null status');
  perform pg_temp.expect_error(format('select public.set_skill_progress_status(%L, %L)', snone, 'learning'), 'P0002', 'status for unknown skill');
  perform pg_temp.expect_error(format('select public.set_skill_progress_status(%L, %L)', sy, 'learning'), '55000', 'lower an assessed skill by hand');
  raise notice 'PASS: A cannot self-assign assessed/proven, cannot lower an assessed skill, unknown skill is rejected';

  -- Evidence: project for two skills, learning with a roadmap step, several per skill.
  r := public.add_skill_evidence(array[sx, sy], 'project', 'SPE Portfolio', 'Built with care',
                                 'https://github.com/example/spe-repo', '{"demo_url":"https://example.com/demo"}');
  g := (r ->> 'group_id')::uuid;
  select count(*) into n from public.skill_evidence where group_id = g and user_id = a and evidence_type = 'project';
  if n <> 2 then raise exception 'FAIL: project evidence for 2 skills created % rows', n; end if;
  select status into st from public.skill_progress where user_id = a and skill_id = sx;
  if st <> 'practicing' then raise exception 'FAIL: project evidence did not move X to practicing (%)', st; end if;
  select status into st from public.skill_progress where user_id = a and skill_id = sy;
  if st <> 'assessed' then raise exception 'FAIL: project evidence lowered assessed Y to %', st; end if;
  select count(*) into n from public.skill_evidence e where e.group_id = g and (e.score is not null or e.assessment_id is not null);
  if n <> 0 then raise exception 'FAIL: project evidence carries a score'; end if;
  raise notice 'PASS: A can add project evidence for several skills (one row each, shared group); progress follows without lowering assessed';

  r := public.add_skill_evidence(array[sz], 'learning', 'SPE roadmap step 1', null, 'https://react.dev/learn',
                                 '{"roadmap_input_hash":"spe-hash-a","roadmap_step":1,"roadmap_skill":"spe roadmap skill"}',
                                 now() - interval '30 days');
  select status into st from public.skill_progress where user_id = a and skill_id = sz;
  if st <> 'learning' then raise exception 'FAIL: learning evidence did not move Z to learning (%)', st; end if;
  r := public.add_skill_evidence(array[sx], 'project', 'SPE second project', null, 'https://medium.com/@spe/post', null);
  r := public.add_skill_evidence(array[sx], 'learning', 'SPE course', null, null, null);
  select count(*) into n from public.skill_evidence where user_id = a and skill_id = sx;
  if n <> 3 then raise exception 'FAIL: expected 3 evidence rows for X, found %', n; end if;
  select status into st from public.skill_progress where user_id = a and skill_id = sx;
  if st <> 'practicing' then raise exception 'FAIL: learning evidence lowered practicing to %', st; end if;
  raise notice 'PASS: learning evidence with a real roadmap step; many evidence rows per skill; status never lowered';

  -- Type authority.
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L)', sx, 'assessment', 'x'), '42501', 'client-created assessment evidence');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L)', sx, 'mentor', 'x'), '22023', 'mentor type');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L)', sx, 'ai_interview', 'x'), '22023', 'ai_interview type (not yet)');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], null, %L)', sx, 'x'), '22023', 'null type');
  raise notice 'PASS: only project/learning accepted from users; assessment evidence refused; unknown types refused';

  -- Skill ids.
  perform pg_temp.expect_error(format('select public.add_skill_evidence(%L::uuid[], %L, %L)', '{}', 'project', 'x'), '22023', 'no skills');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(null, %L, %L)', 'project', 'x'), '22023', 'null skills');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L, %L]::uuid[], %L, %L)', sx, sx, 'project', 'x'), '22023', 'duplicate skills');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L, null]::uuid[], %L, %L)', sx, 'project', 'x'), '22023', 'null skill id');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[[%L],[%L]]::uuid[], %L, %L)', sx, sy, 'project', 'x'), '22023', '2-D skill array');
  perform pg_temp.expect_error(format('select public.add_skill_evidence((select array_agg(gen_random_uuid()) from generate_series(1, 11)), %L, %L)', 'project', 'x'), '22023', '11 skills');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L)', snone, 'project', 'x'), 'P0002', 'unknown skill');
  raise notice 'PASS: skill ids must be 1-10 distinct catalog skills';

  -- Text, URL, date.
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L)', sx, 'project', '   '), '22023', 'blank title');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L)', sx, 'project', repeat('t', 201)), '22023', 'title 201 chars');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L)', sx, 'project', 'two' || chr(10) || 'lines'), '22023', 'multi-line title');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, %L)', sx, 'project', 'x', repeat('d', 2001)), '22023', 'description 2001 chars');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, %L)', sx, 'project', 'x', 'javascript:alert(1)'), '22023', 'javascript: URL');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, %L)', sx, 'project', 'x', 'ftp://example.com/x'), '22023', 'ftp URL');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, %L)', sx, 'project', 'x', 'https://user:pw@github.com/x'), '22023', 'URL with credentials');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, %L)', sx, 'project', 'x', 'https://example.com/x?token=abc'), '22023', 'URL with token');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, %L)', sx, 'project', 'x', 'https://example.com/x?a=1&api_key=abc'), '22023', 'URL with api_key');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, %L)', sx, 'project', 'x', 'https://example.com/a b'), '22023', 'URL with a space');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, %L)', sx, 'project', 'x', 'https://example.com/' || repeat('p', 2040)), '22023', 'URL over 2048');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, null, %L)', sx, 'project', 'x', now() + interval '1 day'), '22023', 'future date');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, null, %L)', sx, 'project', 'x', '1999-12-31'), '22023', 'date before 2000');
  raise notice 'PASS: title, description, URL (scheme, credentials, secrets, length) and date are validated';

  -- Metadata.
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'project', 'x', '[1]'), '22023', 'metadata array');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'project', 'x', '"text"'), '22023', 'metadata string');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'project', 'x',
    jsonb_build_object('demo_url', 'https://example.com/' || repeat('m', 5000))), '22023', 'oversized metadata');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'project', 'x',
    jsonb_build_object('user_id', b)), '22023', 'metadata user_id');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'project', 'x',
    '{"score": 100}'), '22023', 'metadata score');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'project', 'x',
    '{"demo_url": "javascript:alert(1)"}'), '22023', 'bad demo_url');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'project', 'x',
    '{"demo_url": 5}'), '22023', 'demo_url not a string');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'learning', 'x',
    '{"demo_url": "https://example.com"}'), '22023', 'project key on learning');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'learning', 'x',
    '{"roadmap_step": 1}'), '22023', 'partial roadmap reference');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'learning', 'x',
    '{"roadmap_input_hash":"spe-hash-a","roadmap_step":1.5,"roadmap_skill":"SPE Roadmap Skill"}'), '22023', 'fractional step');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'learning', 'x',
    '{"roadmap_input_hash":"spe-hash-a","roadmap_step":51,"roadmap_skill":"SPE Roadmap Skill"}'), '22023', 'step out of range');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'learning', 'x',
    '{"roadmap_input_hash":"spe-hash-a","roadmap_step":2,"roadmap_skill":"SPE Roadmap Skill"}'), '22023', 'step/skill mismatch');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L, null, null, %L)', sx, 'learning', 'x',
    '{"roadmap_input_hash":"someone-elses-hash","roadmap_step":1,"roadmap_skill":"SPE Roadmap Skill"}'), '22023', 'roadmap not A''s current one');
  raise notice 'PASS: metadata must be a small object with per-type keys; roadmap references must match A''s own current roadmap';

  -- No way to write the tables directly, for self or anyone else.
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title) values (%L, %L, %L, %L)', a, sx, 'project', 'direct'), '42501', 'direct insert own evidence');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, score, assessment_id) values (%L, %L, %L, %L, 100, %L)',
    a, sx, 'assessment', 'fake 100', current_setting('spe.asa')), '42501', 'direct insert assessment 100');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title) values (%L, %L, %L, %L)', b, sx, 'project', 'spoof'), '42501', 'direct insert as B');
  perform pg_temp.expect_error(format('insert into public.skill_progress (user_id, skill_id, status) values (%L, %L, %L)', a, sz, 'proven'), '42501', 'direct insert progress');
  perform pg_temp.expect_error(format('update public.skill_progress set confidence_score = 99, confidence_updated_at = now() where user_id = %L', a), '42501', 'direct confidence 99');
  perform pg_temp.expect_error(format('update public.skill_progress set status = %L where user_id = %L', 'proven', a), '42501', 'direct status proven');
  perform pg_temp.expect_error(format('update public.skill_evidence set score = 100 where user_id = %L', a), '42501', 'direct score 100');
  perform pg_temp.expect_error(format('update public.skill_evidence set user_id = %L where user_id = %L', b, a), '42501', 're-point evidence to B');
  perform pg_temp.expect_error(format('delete from public.skill_evidence where user_id = %L', a), '42501', 'delete own evidence');
  perform pg_temp.expect_error(format('delete from public.skill_progress where user_id = %L', a), '42501', 'delete own progress');
  perform pg_temp.expect_error('truncate public.skill_evidence', '42501', 'truncate evidence');
  perform pg_temp.expect_error(format('select public.skill_evidence_check_metadata(%L, %L, %L)', a, 'project', '{}'), '42501', 'internal metadata helper');
  raise notice 'PASS: A cannot insert, update (confidence, status, score, owner), delete or truncate either table directly';

  -- Cross-user writes and id enumeration: B's id and a random id look the same.
  perform pg_temp.expect_error(format('select public.update_skill_evidence(%L, %L)', evb, 'hijacked'), 'P0002', 'edit B''s evidence');
  perform pg_temp.expect_error(format('select public.retract_skill_evidence(%L)', evb), 'P0002', 'retract B''s evidence');
  perform pg_temp.expect_error(format('select public.update_skill_evidence(%L, %L)', gen_random_uuid(), 'x'), 'P0002', 'edit unknown id');
  perform pg_temp.expect_error(format('select public.retract_skill_evidence(%L)', gen_random_uuid()), 'P0002', 'retract unknown id');
  raise notice 'PASS: A cannot edit or retract B''s evidence; B''s id and an unknown id give the same "not found"';

  -- Editing and retracting own evidence.
  select id into ev from public.skill_evidence where user_id = a and skill_id = sx and title = 'SPE second project';
  r := public.update_skill_evidence(ev, 'SPE second project (renamed)', 'now with notes', 'https://github.com/example/spe-2',
                                    '{"demo_url":"https://example.com/spe-2"}');
  if r ->> 'title' <> 'SPE second project (renamed)' or r -> 'metadata' ->> 'demo_url' <> 'https://example.com/spe-2'
     or r ->> 'evidence_type' <> 'project' or (r ->> 'user_id')::uuid <> a then
    raise exception 'FAIL: own project evidence edit did not apply: %', r;
  end if;
  perform pg_temp.expect_error(format('select public.update_skill_evidence(%L, %L, null, %L)', ev, 'x', 'http://user@evil.example'), '22023', 'edit to bad URL');
  perform pg_temp.expect_error(format('select public.update_skill_evidence(%L, %L, null, null, %L)', ev, 'x', '{"score":100}'), '22023', 'edit metadata to add score');

  select id into ev from public.skill_evidence where user_id = a and skill_id = sz and evidence_type = 'learning';
  r := public.update_skill_evidence(ev, 'SPE roadmap step 1 (done)', 'notes', null, null);
  if r -> 'metadata' ->> 'roadmap_input_hash' <> 'spe-hash-a' then raise exception 'FAIL: learning edit lost its roadmap reference'; end if;
  perform pg_temp.expect_error(format('select public.update_skill_evidence(%L, %L, null, null, %L)', ev, 'x', '{"roadmap_input_hash":"other","roadmap_step":1,"roadmap_skill":"x"}'), '22023', 'change roadmap reference');

  select id into ev from public.skill_evidence where user_id = a and skill_id = sx and title = 'SPE course';
  r := public.retract_skill_evidence(ev);
  if r ->> 'retracted_at' is null then raise exception 'FAIL: retraction did not set retracted_at'; end if;
  st := r ->> 'retracted_at';
  r := public.retract_skill_evidence(ev);
  if r ->> 'retracted_at' <> st then raise exception 'FAIL: second retraction changed retracted_at'; end if;
  select count(*) into n from public.skill_evidence where id = ev;
  if n <> 1 then raise exception 'FAIL: retracted evidence disappeared (history must be kept)'; end if;
  perform pg_temp.expect_error(format('select public.update_skill_evidence(%L, %L)', ev, 'x'), '55000', 'edit retracted evidence');

  perform pg_temp.expect_error(format('select public.update_skill_evidence(%L, %L)', current_setting('spe.ev_a_assess'), 'x'), '42501', 'edit own assessment evidence');
  perform pg_temp.expect_error(format('select public.retract_skill_evidence(%L)', current_setting('spe.ev_a_assess')), '42501', 'retract own assessment evidence');
  raise notice 'PASS: A can edit and retract own project/learning evidence (kept as history); assessment evidence and roadmap references are fixed';

  perform set_config('spe.ev_a_proj',
    (select id::text from public.skill_evidence where user_id = a and skill_id = sx and title = 'SPE Portfolio'), true);
end $$;

reset role;

-- 5. Authenticated user B --------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('spe.b'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('spe.b'), true);
set local role authenticated;

do $$
declare
  a uuid := current_setting('spe.a')::uuid;  b uuid := current_setting('spe.b')::uuid;
  n bigint; ev uuid;
begin
  select count(*) into n from public.skill_evidence where user_id = a;
  if n <> 0 then raise exception 'FAIL: B can read A''s evidence'; end if;
  select count(*) into n from public.skill_progress where user_id = a;
  if n <> 0 then raise exception 'FAIL: B can read A''s progress'; end if;
  select count(*) into n from public.skill_evidence;
  if n <> 2 then raise exception 'FAIL: B sees % evidence rows, expected its own 2', n; end if;

  ev := current_setting('spe.ev_a_proj')::uuid;
  select count(*) into n from public.skill_evidence where id = ev;
  if n <> 0 then raise exception 'FAIL: B can read A''s evidence by id'; end if;
  perform pg_temp.expect_error(format('select public.update_skill_evidence(%L, %L)', ev, 'B was here'), 'P0002', 'B edits A''s evidence');
  perform pg_temp.expect_error(format('select public.retract_skill_evidence(%L)', ev), 'P0002', 'B retracts A''s evidence');
  perform pg_temp.expect_error(format('update public.skill_progress set status = %L where user_id = %L', 'proven', a), '42501', 'B updates A''s progress');
  raise notice 'PASS: B cannot read, edit or retract A''s evidence, nor touch A''s progress';
end $$;

reset role;

-- 6. Signed in without a profile ---------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('spe.c'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('spe.c'), true);
set local role authenticated;

do $$
begin
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L)', current_setting('spe.sx'), 'project', 'x'), '23503', 'evidence without a profile');
  perform pg_temp.expect_error(format('select public.set_skill_progress_status(%L, %L)', current_setting('spe.sx'), 'learning'), '23503', 'progress without a profile');
  raise notice 'PASS: a signed-in user without a profile cannot create progress or evidence';
end $$;

reset role;

-- 7. Evidence limit (user D) -------------------------------------------------------
insert into public.skill_evidence (user_id, skill_id, evidence_type, title)
select current_setting('spe.d')::uuid, current_setting('spe.sx')::uuid, 'learning', 'SPE filler ' || g
from generate_series(1, 999) g;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('spe.d'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('spe.d'), true);
set local role authenticated;

do $$
begin
  perform public.add_skill_evidence(array[current_setting('spe.sy')::uuid], 'project', 'SPE record 1000');
  perform pg_temp.expect_error(format('select public.add_skill_evidence(array[%L]::uuid[], %L, %L)', current_setting('spe.sz'), 'project', 'x'), '54000', 'record 1001');
  raise notice 'PASS: evidence is capped at 1000 records per user';
end $$;

reset role;

-- 8. Integrity, as the owner --------------------------------------------------------
do $$
declare
  a uuid := current_setting('spe.a')::uuid;  b uuid := current_setting('spe.b')::uuid;
  sx uuid := current_setting('spe.sx')::uuid; sy uuid := current_setting('spe.sy')::uuid;
  sz uuid := current_setting('spe.sz')::uuid;
  asa uuid := current_setting('spe.asa')::uuid; asb uuid := current_setting('spe.asb')::uuid;
  n bigint; ev_new uuid; ev_old uuid; latest uuid;
begin
  -- Assessment evidence: needs its own user's assessment and a score; nothing else scores.
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, score, assessment_id) values (%L, %L, %L, %L, 90, %L)',
    a, sx, 'assessment', 'claims B''s assessment', asb), '23503', 'assessment evidence on another user''s assessment');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, assessment_id) values (%L, %L, %L, %L, %L)',
    a, sx, 'assessment', 'no score', asa), '23514', 'assessment evidence without score');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, score) values (%L, %L, %L, %L, 70)',
    a, sx, 'assessment', 'no assessment'), '23514', 'assessment evidence without assessment');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, score, assessment_id) values (%L, %L, %L, %L, 101, %L)',
    a, sx, 'assessment', 'score 101', asa), '23514', 'score 101');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, score, assessment_id) values (%L, %L, %L, %L, -1, %L)',
    a, sx, 'assessment', 'score -1', asa), '23514', 'score -1');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, score) values (%L, %L, %L, %L, 50)',
    a, sx, 'project', 'scored project'), '23514', 'score on project evidence');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title) values (%L, %L, %L, %L)',
    a, sx, 'mentor', 'mentor'), '23514', 'mentor type at table level');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, source_url) values (%L, %L, %L, %L, %L)',
    a, sx, 'project', 'x', 'javascript:alert(1)'), '23514', 'bad URL at table level');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, metadata) values (%L, %L, %L, %L, %L)',
    a, sx, 'project', 'x', '[]'), '23514', 'array metadata at table level');
  perform pg_temp.expect_error(format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title, metadata) values (%L, %L, %L, %L, %L)',
    a, sx, 'project', 'x', jsonb_build_object('k', repeat('m', 5000))), '23514', 'oversized metadata at table level');
  perform pg_temp.expect_error(format('update public.skill_evidence set retracted_at = now() where id = %L', current_setting('spe.ev_a_assess')), '23514', 'retract assessment at table level');
  raise notice 'PASS: assessment evidence needs the same user''s assessment and a 0-100 score; only assessment evidence has a score; table checks back up every rule';

  -- Latest assessment follows the most recent result, not the most recent insert.
  insert into public.skill_evidence (user_id, skill_id, evidence_type, title, score, assessment_id, observed_at)
  values (a, sz, 'assessment', 'SPE Z assessment (10 days ago)', 60, asa, now() - interval '10 days') returning id into ev_new;
  insert into public.skill_evidence (user_id, skill_id, evidence_type, title, score, assessment_id, observed_at)
  values (a, sz, 'assessment', 'SPE Z assessment (20 days ago)', 40, asa, now() - interval '20 days') returning id into ev_old;
  select latest_assessment_evidence_id into latest from public.skill_progress where user_id = a and skill_id = sz;
  if latest is distinct from ev_new then raise exception 'FAIL: an older assessment replaced the latest one'; end if;
  select count(*) into n from public.skill_progress where user_id = a and skill_id = sz and status = 'assessed'
    and last_assessed_at = (select observed_at from public.skill_evidence where id = ev_new);
  if n <> 1 then raise exception 'FAIL: progress not marked assessed at the latest result'; end if;
  select count(*) into n from public.skill_evidence where user_id = a and skill_id = sz and evidence_type = 'assessment';
  if n <> 2 then raise exception 'FAIL: multiple assessments per skill not kept'; end if;
  raise notice 'PASS: multiple assessments per skill are kept; progress points at the most recent result';

  -- Progress rules.
  perform pg_temp.expect_error(format('insert into public.skill_progress (user_id, skill_id) values (%L, %L)', a, sx), '23505', 'second progress row for the same skill');
  perform pg_temp.expect_error(format('update public.skill_progress set status = %L where user_id = %L and skill_id = %L', 'proven', a, sx), '23514', 'proven without confidence');
  perform pg_temp.expect_error(format('update public.skill_progress set status = %L where user_id = %L and skill_id = %L', 'assessed', a, sx), '23514', 'assessed without an assessment');
  perform pg_temp.expect_error(format('update public.skill_progress set confidence_score = 50 where user_id = %L and skill_id = %L', a, sx), '23514', 'confidence without timestamp');
  perform pg_temp.expect_error(format('update public.skill_progress set confidence_score = 101, confidence_updated_at = now() where user_id = %L and skill_id = %L', a, sx), '23514', 'confidence 101');
  perform pg_temp.expect_error(format('update public.skill_progress set learning_progress = 150 where user_id = %L and skill_id = %L', a, sx), '23514', 'learning progress 150');
  perform pg_temp.expect_error(format('update public.skill_progress set latest_assessment_evidence_id = %L, last_assessed_at = now() where user_id = %L and skill_id = %L',
    ev_new, a, sx), '23503', 'latest assessment from another skill');
  perform pg_temp.expect_error(format('update public.skill_progress set status = %L where user_id = %L and skill_id = %L', 'expert', a, sx), '23514', 'unknown status');
  raise notice 'PASS: one progress row per skill; assessed/proven need their basis; confidence and progress stay within 0-100';

  -- Deletion behaviour.
  perform pg_temp.expect_error(format('delete from public.skills where id = %L', sx), '23503', 'delete a skill that has history');
  perform pg_temp.expect_error(format('delete from public.assessments where id = %L', asa), '23503', 'delete an assessment that has evidence');
  delete from public.profiles where id = a;
  select (select count(*) from public.skill_evidence where user_id = a) + (select count(*) from public.skill_progress where user_id = a)
         + (select count(*) from public.assessments where user_id = a) into n;
  if n <> 0 then raise exception 'FAIL: deleting A''s profile left % rows behind', n; end if;
  select count(*) into n from public.skill_evidence where user_id = b;
  if n <> 2 then raise exception 'FAIL: deleting A affected B''s evidence'; end if;
  raise notice 'PASS: skills and assessments with history cannot be deleted; deleting a profile removes its progress, evidence and assessments together';

  -- Nothing real changed.
  if (select md5(coalesce(string_agg(r::text, '|' order by r.user_id, r.skill_id), ''))
      from public.skill_progress r where r.user_id not in (a, b, current_setting('spe.d')::uuid))
     is distinct from current_setting('spe.real_progress')
     or (select md5(coalesce(string_agg(r::text, '|' order by r.id), ''))
         from public.skill_evidence r where r.user_id not in (a, b, current_setting('spe.d')::uuid))
     is distinct from current_setting('spe.real_evidence')
     or (select md5(coalesce(string_agg(p::text, '|' order by p.id), ''))
         from public.profiles p where p.id not in (a, b, current_setting('spe.d')::uuid))
     is distinct from current_setting('spe.real_profiles')
     or (select md5(coalesce(string_agg(s::text, '|' order by s.id), ''))
         from public.skills s where s.id not in (sx, sy, sz))
     is distinct from current_setting('spe.real_skills')
     or (select md5(coalesce(string_agg(s::text, '|' order by s.id), ''))
         from public.assessments s where s.id not in (asa, asb))
     is distinct from current_setting('spe.real_assessments') then
    raise exception 'FAIL: real (non-test) rows changed during the test';
  end if;
  raise notice 'PASS: real progress, evidence, profiles, skills and assessments untouched';

  raise exception 'SKILL PROGRESS EVIDENCE VERIFICATION PASSED: all checks passed. This error is intentional: it rolls back every temporary test row.';
end $$;

rollback;
