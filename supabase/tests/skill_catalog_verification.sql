-- =============================================================================
-- Verification for the canonical skill catalog (public.skills + public.skill_aliases)
-- =============================================================================
-- Run the WHOLE script at once in the Supabase SQL Editor (do not run a selection),
-- as the database owner, after 20260928120000_skill_catalog_aliases.sql.
--
-- What it does:
--   * Structure: skill_aliases columns, key rules, foreign key, RLS, the single read-all
--     policy, read-only privileges.
--   * Catalog integrity: no two skills or aliases share a key, no alias shadows a skill
--     name, the 16 assessment skills and the 21 curated additions exist, sample aliases
--     point where intended, and skills that must stay apart do (Java / JavaScript,
--     SQL / PostgreSQL / MySQL).
--   * Phase 1 integrity: every progress and evidence row references a catalog skill.
--   * Security, impersonating anon and authenticated like the Data API: the catalog can be
--     read and not written; a catalog id or alias gives no access to another user's
--     progress or evidence; a new catalog skill can carry the user's own evidence.
--   * Fingerprints real rows before the tests and proves nothing real was changed.
--
-- It NEVER keeps any change: the script always ends in an error, so everything rolls back.
--   Success: the error message starts with  "SKILL CATALOG VERIFICATION PASSED"
--   Failure: the error message starts with  "FAIL:"  and names the failing check
--   Setup problem (not a security result):  "SETUP ERROR:"
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.skill_aliases') is null then
    raise exception 'FAIL: public.skill_aliases does not exist';
  end if;
end $$;

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

create function pg_temp.skill_id(p_name text) returns uuid language sql stable as $$
  select id from public.skills where lower(name) = lower(p_name)
$$;
grant execute on function pg_temp.skill_id(text) to anon, authenticated;

select set_config('scv.a', gen_random_uuid()::text, true),
       set_config('scv.b', gen_random_uuid()::text, true),
       set_config('scv.real_catalog',
         (select md5(coalesce(string_agg(s::text, '|' order by s.id), '')) from public.skills s), true),
       set_config('scv.real_aliases',
         (select md5(coalesce(string_agg(a::text, '|' order by a.alias_key), '')) from public.skill_aliases a), true),
       set_config('scv.real_progress',
         (select md5(coalesce(string_agg(r::text, '|' order by r.user_id, r.skill_id), '')) from public.skill_progress r), true),
       set_config('scv.real_evidence',
         (select md5(coalesce(string_agg(r::text, '|' order by r.id), '')) from public.skill_evidence r), true),
       set_config('scv.real_profiles',
         (select md5(coalesce(string_agg(p::text, '|' order by p.id), '')) from public.profiles p), true);

-- 1. Structure --------------------------------------------------------------------
do $$
declare bad text;
begin
  with expected(col, typ, not_null) as (
    values ('alias_key', 'text', true), ('alias', 'text', true), ('skill_id', 'uuid', true),
           ('created_at', 'timestamp with time zone', true)
  ),
  actual as (
    select a.attname::text as col, format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as not_null
    from pg_attribute a where a.attrelid = 'public.skill_aliases'::regclass and a.attnum > 0 and not a.attisdropped
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || col as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || col from (select * from expected except select * from actual) y)
  ) z;
  if bad is not null then raise exception 'FAIL: skill_aliases columns differ: %', bad; end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.skill_aliases'::regclass and contype = 'p'
                 and conkey = array[(select attnum from pg_attribute where attrelid = 'public.skill_aliases'::regclass and attname = 'alias_key')]::int2[]) then
    raise exception 'FAIL: alias_key is not the primary key (one alias, one skill)';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.skill_aliases'::regclass and contype = 'f'
                 and confrelid = 'public.skills'::regclass and confdeltype = 'c') then
    raise exception 'FAIL: skill_aliases.skill_id must reference skills(id) ON DELETE CASCADE';
  end if;
  raise notice 'PASS: skill_aliases columns; alias_key is the primary key; skill_id references skills';

  if not (select relrowsecurity from pg_class where oid = 'public.skill_aliases'::regclass) then
    raise exception 'FAIL: RLS is not enabled on skill_aliases';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'skill_aliases') <> 1
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'skill_aliases'
                    and policyname = 'skill_aliases_read_all' and cmd = 'SELECT' and permissive = 'PERMISSIVE'
                    and roles @> array['anon', 'authenticated']::name[] and coalesce(qual, '') = 'true') then
    raise exception 'FAIL: skill_aliases must have exactly one policy: read-all SELECT for anon and authenticated';
  end if;
  if has_table_privilege('anon', 'public.skill_aliases', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.skill_aliases', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('anon', 'public.skills', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.skills', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or not has_table_privilege('anon', 'public.skill_aliases', 'SELECT')
     or not has_table_privilege('authenticated', 'public.skill_aliases', 'SELECT') then
    raise exception 'FAIL: skills and skill_aliases must be read-only for anon and authenticated';
  end if;
  raise notice 'PASS: RLS on; one read-all policy; the catalog and aliases are read-only through the API';
end $$;

-- 2. Catalog integrity --------------------------------------------------------------
do $$
declare bad text; n bigint;
begin
  select string_agg(k, ', ') into bad from (
    select lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) k from public.skills group by 1 having count(*) > 1) d;
  if bad is not null then raise exception 'FAIL: skills share a name ignoring case/spacing: %', bad; end if;

  select string_agg(alias, ', ') into bad from public.skill_aliases
  where alias_key <> lower(btrim(regexp_replace(alias, '\s+', ' ', 'g')));
  if bad is not null then raise exception 'FAIL: alias keys not normalised: %', bad; end if;

  select string_agg(a.alias, ', ') into bad from public.skill_aliases a
  join public.skills s on lower(btrim(regexp_replace(s.name, '\s+', ' ', 'g'))) = a.alias_key;
  if bad is not null then raise exception 'FAIL: aliases shadow a canonical skill name: %', bad; end if;
  raise notice 'PASS: canonical names unique ignoring case and spacing; alias keys normalised; no alias equals a skill name';

  select string_agg(nm, ', ') into bad from unnest(array[
    'Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'React', 'Node.js', 'REST APIs', 'SQL', 'PostgreSQL',
    'MongoDB', 'DSA', 'Git', 'Linux', 'Docker', 'AWS',
    'HTML', 'CSS', 'Next.js', 'GraphQL', 'Django', 'Database Design', 'MySQL', 'NoSQL', 'Statistics', 'NumPy',
    'Pandas', 'Data Visualization', 'Machine Learning', 'Scikit-learn', 'CI/CD', 'Kubernetes', 'Terraform',
    'Computer Networking', 'Object-Oriented Programming', 'Object-Oriented Design', 'Design Patterns',
    'System Design', 'Microservices', 'Testing', 'Unit Testing', 'Test-Driven Development']) nm
  where pg_temp.skill_id(nm) is null;
  if bad is not null then raise exception 'FAIL: catalog skills missing: %', bad; end if;
  raise notice 'PASS: the 16 assessment skills and the 26 curated skills are in the catalog';

  -- Compound or vague terms are deliberately neither skills nor aliases.
  select string_agg(t, ', ') into bad
  from unnest(array['html & css', 'html and css', 'html/css', 'object-oriented design & design patterns',
                    'testing & test-driven development', 'programming fundamentals', 'programming basics',
                    'core programming']) t
  where exists (select 1 from public.skills where lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) = t)
     or exists (select 1 from public.skill_aliases where alias_key = t);
  if bad is not null then raise exception 'FAIL: terms that must stay unresolved became a skill or alias: %', bad; end if;
  raise notice 'PASS: HTML & CSS, OOD & Design Patterns, Testing & TDD, Programming Fundamentals/Basics and Core Programming stay unresolved';

  select string_agg(format('%s -> %s', e.alias, coalesce(s.name, 'nothing')), ', ') into bad
  from (values ('React.js', 'React'), ('ReactJS', 'React'), ('NodeJS', 'Node.js'), ('Node', 'Node.js'),
               ('JS', 'JavaScript'), ('Postgres', 'PostgreSQL'), ('REST API', 'REST APIs'),
               ('Data Structures & Algorithms', 'DSA'), ('ML', 'Machine Learning'), ('K8s', 'Kubernetes'),
               ('Networking', 'Computer Networking'), ('OOP', 'Object-Oriented Programming'),
               ('TDD', 'Test-Driven Development'), ('HTML5', 'HTML'), ('CSS3', 'CSS')) e(alias, canonical)
  left join public.skill_aliases a on a.alias_key = lower(e.alias)
  left join public.skills s on s.id = a.skill_id
  where s.name is distinct from e.canonical;
  if bad is not null then raise exception 'FAIL: aliases point at the wrong skill: %', bad; end if;
  raise notice 'PASS: sample aliases resolve to their canonical skills';

  -- Skills that must stay apart.
  if pg_temp.skill_id('Java') = pg_temp.skill_id('JavaScript')
     or pg_temp.skill_id('SQL') = pg_temp.skill_id('PostgreSQL')
     or exists (select 1 from public.skill_aliases a join public.skills s on s.id = a.skill_id
                where (a.alias_key in ('java', 'javascript') and s.name not in ('Java', 'JavaScript'))
                   or (a.alias_key like 'java%' and a.alias_key not like 'javascript%' and s.name = 'JavaScript')
                   or (a.alias_key like 'javascript%' and s.name = 'Java')
                   or (a.alias_key in ('mysql', 'sql', 'postgresql', 'postgres', 'sqlite', 'mariadb')
                       and s.name = 'SQL')
                   or (a.alias_key in ('sql', 'mysql') and s.name = 'PostgreSQL')) then
    raise exception 'FAIL: Java/JavaScript or SQL/PostgreSQL/MySQL were merged';
  end if;
  raise notice 'PASS: Java and JavaScript stay separate; SQL, PostgreSQL and MySQL are not merged';

  -- Related but independently measurable skills keep separate identities.
  select string_agg(format('%s / %s', p.a, p.b), ', ') into bad
  from (values ('HTML', 'CSS'), ('SQL', 'PostgreSQL'), ('SQL', 'MySQL'), ('PostgreSQL', 'MySQL'),
               ('NoSQL', 'MongoDB'), ('NoSQL', 'SQL'), ('Testing', 'Unit Testing'),
               ('Testing', 'Test-Driven Development'), ('Unit Testing', 'Test-Driven Development'),
               ('Object-Oriented Programming', 'Object-Oriented Design'),
               ('Object-Oriented Design', 'Design Patterns'), ('Java', 'JavaScript')) p(a, b)
  where pg_temp.skill_id(p.a) is null or pg_temp.skill_id(p.b) is null
     or pg_temp.skill_id(p.a) = pg_temp.skill_id(p.b);
  if bad is not null then raise exception 'FAIL: related skills missing or merged: %', bad; end if;
  if exists (select 1 from public.skill_aliases a join public.skills s on s.id = a.skill_id
             where (a.alias_key in ('html', 'css', 'mongodb', 'nosql', 'unit testing', 'test-driven development',
                                    'tdd', 'design patterns', 'object-oriented programming', 'oop')
                    and s.name in ('Testing', 'Object-Oriented Design', 'SQL', 'MongoDB', 'NoSQL', 'HTML', 'CSS')
                    and lower(s.name) <> a.alias_key)) then
    raise exception 'FAIL: an alias folds one related skill into another';
  end if;
  raise notice 'PASS: HTML / CSS, SQL / PostgreSQL / MySQL / NoSQL / MongoDB, Testing / Unit Testing / TDD, OOP / OOD / Design Patterns are all separate';

  select count(*) into n from public.skill_progress p where not exists (select 1 from public.skills s where s.id = p.skill_id);
  if n <> 0 then raise exception 'FAIL: % progress rows reference no catalog skill', n; end if;
  select count(*) into n from public.skill_evidence e where not exists (select 1 from public.skills s where s.id = e.skill_id);
  if n <> 0 then raise exception 'FAIL: % evidence rows reference no catalog skill', n; end if;
  raise notice 'PASS: every progress and evidence row references a catalog skill';
end $$;

-- 3. Test users and their rows (rolled back at the end) --------------------------------
do $$
begin
  insert into public.profiles (id, name, target_role, experience_level, job_readiness, skills_mastered, skill_gaps, learning_progress, skills)
  values (current_setting('scv.a')::uuid, 'SCV Test A', 'DevOps Engineer', 'Beginner', 0, 0, 0, 0, '["K8s", "Postgres"]'),
         (current_setting('scv.b')::uuid, 'SCV Test B', 'Data Analyst', 'Beginner', 0, 0, 0, 0, '["React.js"]');
  insert into public.skill_evidence (user_id, skill_id, evidence_type, title)
  values (current_setting('scv.b')::uuid, pg_temp.skill_id('React'), 'project', 'SCV B React project'),
         (current_setting('scv.b')::uuid, pg_temp.skill_id('Kubernetes'), 'learning', 'SCV B Kubernetes course');
exception when others then
  raise exception 'SETUP ERROR: could not create temporary test data (%). This is not a security result.', sqlerrm;
end $$;

-- 4. anon: reads the catalog, writes nothing, sees no one's progress ---------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true),
       set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
declare n bigint;
begin
  select count(*) into n from public.skill_aliases where alias_key = 'react.js';
  if n <> 1 then raise exception 'FAIL: anon cannot read the aliases'; end if;
  perform pg_temp.expect_error('insert into public.skill_aliases (alias_key, alias, skill_id) values (''x'', ''x'', gen_random_uuid())', '42501', 'anon adds an alias');
  perform pg_temp.expect_error('update public.skill_aliases set skill_id = skill_id', '42501', 'anon re-points an alias');
  perform pg_temp.expect_error('delete from public.skill_aliases', '42501', 'anon deletes aliases');
  perform pg_temp.expect_error('insert into public.skills (id, name) values (gen_random_uuid(), ''anon skill'')', '42501', 'anon adds a skill');
  perform pg_temp.expect_error('update public.skills set name = name', '42501', 'anon renames skills');
  perform pg_temp.expect_error('select count(*) from public.skill_evidence', '42501', 'anon reads evidence');
  raise notice 'PASS: anon can read the catalog and aliases, and cannot write them or read evidence';
end $$;

reset role;

-- 5. Authenticated user A -------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('scv.a'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('scv.a'), true);
set local role authenticated;

do $$
declare n bigint; r jsonb;
begin
  perform pg_temp.expect_error(format('insert into public.skill_aliases (alias_key, alias, skill_id) values (%L, %L, %L)',
    'my react', 'My React', pg_temp.skill_id('React')), '42501', 'user adds an alias');
  perform pg_temp.expect_error(format('update public.skill_aliases set skill_id = %L where alias_key = %L',
    pg_temp.skill_id('Java'), 'js'), '42501', 'user re-points JS to Java');
  perform pg_temp.expect_error('delete from public.skill_aliases where alias_key = ''node''', '42501', 'user deletes an alias');
  perform pg_temp.expect_error('update public.skills set name = ''Hijacked'' where name = ''React''', '42501', 'user renames a skill');
  raise notice 'PASS: a user cannot add, re-point or delete aliases, or rename skills';

  -- B has evidence for React and Kubernetes; looking them up by catalog id or through an
  -- alias's skill id shows A nothing.
  select count(*) into n from public.skill_evidence
  where skill_id in (pg_temp.skill_id('React'), pg_temp.skill_id('Kubernetes'))
     or skill_id in (select skill_id from public.skill_aliases where alias_key in ('react.js', 'k8s'));
  if n <> 0 then raise exception 'FAIL: a catalog id or alias exposed another user''s evidence (% rows)', n; end if;
  select count(*) into n from public.skill_progress where skill_id = pg_temp.skill_id('React');
  if n <> 0 then raise exception 'FAIL: a catalog id exposed another user''s progress'; end if;
  raise notice 'PASS: catalog ids and aliases give no access to another user''s progress or evidence';

  -- A new catalog skill carries A's own evidence and progress.
  r := public.add_skill_evidence(array[pg_temp.skill_id('Kubernetes')], 'learning', 'SCV A Kubernetes basics');
  r := public.set_skill_progress_status(pg_temp.skill_id('Terraform'), 'learning');
  select count(*) into n from public.skill_evidence where skill_id = pg_temp.skill_id('Kubernetes');
  if n <> 1 then raise exception 'FAIL: A should see exactly its own Kubernetes evidence, sees %', n; end if;
  select count(*) into n from public.skill_progress where skill_id in (pg_temp.skill_id('Kubernetes'), pg_temp.skill_id('Terraform'))
    and confidence_score is null;
  if n <> 2 then raise exception 'FAIL: curated skills did not take A''s progress (or confidence was set)'; end if;
  raise notice 'PASS: curated catalog skills can carry the user''s own evidence and progress; confidence stays unset';
end $$;

reset role;

-- 6. Nothing real changed; claims untouched ----------------------------------------------
do $$
declare a uuid := current_setting('scv.a')::uuid; b uuid := current_setting('scv.b')::uuid;
begin
  if (select skills::text from public.profiles where id = a) <> '["K8s", "Postgres"]' then
    raise exception 'FAIL: a profile''s claimed skills were rewritten';
  end if;
  if (select md5(coalesce(string_agg(s::text, '|' order by s.id), '')) from public.skills s) <> current_setting('scv.real_catalog')
     or (select md5(coalesce(string_agg(x::text, '|' order by x.alias_key), '')) from public.skill_aliases x) <> current_setting('scv.real_aliases')
     or (select md5(coalesce(string_agg(r::text, '|' order by r.user_id, r.skill_id), '')) from public.skill_progress r
         where r.user_id not in (a, b)) is distinct from current_setting('scv.real_progress')
     or (select md5(coalesce(string_agg(r::text, '|' order by r.id), '')) from public.skill_evidence r
         where r.user_id not in (a, b)) is distinct from current_setting('scv.real_evidence')
     or (select md5(coalesce(string_agg(p::text, '|' order by p.id), '')) from public.profiles p
         where p.id not in (a, b)) is distinct from current_setting('scv.real_profiles') then
    raise exception 'FAIL: real catalog, alias, progress, evidence or profile rows changed during the test';
  end if;
  raise notice 'PASS: profile claims stay as written; real catalog, aliases, progress, evidence and profiles untouched';

  raise exception 'SKILL CATALOG VERIFICATION PASSED: all checks passed. This error is intentional: it rolls back every temporary test row.';
end $$;

rollback;
