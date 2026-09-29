-- =============================================================================
-- Canonical skill identity: curated catalog additions + explicit aliases
-- (public.skills, public.skill_aliases)
-- =============================================================================
-- public.skills stays the single canonical skill identity (Phase 1 references it from
-- skill_progress and skill_evidence). This migration only ADDS to it:
--
--   1. Curated skills. Every name below is used by SkillBridge today: the career-analysis
--      fallback requirement lists and the learning route's documentation map
--      (app/api/ai/career-analysis/route.ts, app/api/learning/route.ts), or skill names the
--      AI actually produced in stored analyses and roadmaps. The live catalog already holds
--      the 16 skills the assessment offers. No speculative entries.
--   2. public.skill_aliases: other spellings SkillBridge meets for a catalog skill
--      ("React.js" -> React, "NodeJS" -> Node.js, "Data Structures & Algorithms" -> DSA).
--      One alias maps to exactly one skill, which only a table with a plain unique key can
--      enforce. Aliases are explicit: nothing is inferred by substring or similarity.
--
-- The catalog keeps independently measurable skills apart. An alias is only a different
-- way of writing the SAME skill (normalisation); related skills are never folded into one
-- another: HTML / CSS, SQL / MySQL / PostgreSQL / NoSQL / MongoDB, Testing / Unit Testing /
-- Test-Driven Development, Object-Oriented Programming / Object-Oriented Design / Design
-- Patterns, Java / JavaScript are all separate identities. Compound or vague terms that
-- name several skills or none ("HTML & CSS", "Object-Oriented Design & Design Patterns",
-- "Testing & Test-Driven Development", "Programming Fundamentals", "Core Programming") are
-- deliberately left unresolved rather than recorded against the wrong skill; the
-- self-check refuses to make any of them a skill or an alias.
--
-- Intentionally coarse identities, kept as single skills for now: DSA, CI/CD, Machine
-- Learning, System Design, AWS. They may later need child skills (for example AWS Lambda,
-- Deep Learning); there is no skill hierarchy yet.
--
-- Keys: an alias is matched on alias_key = lower(trimmed, single-spaced alias), the same
-- normalisation lib/skills/catalog.ts applies. A canonical name always wins over an alias
-- with the same key; the self-check refuses such a collision.
--
-- Nothing else changes: existing skills keep their ids, names and categories; no row is
-- updated or deleted; profiles.skills (the users' claims) is not touched; no progress,
-- evidence or confidence is created. The catalog and aliases are public reference data
-- (anon and authenticated may read, nobody may write through the API), like public.skills.
--
-- Safe to re-run. Aborts, changing nothing, if a precondition or the final self-check
-- fails.
-- =============================================================================

begin;

-- 1. Preconditions ------------------------------------------------------------
do $$
declare dupes text;
begin
  if to_regclass('public.skill_progress') is null or to_regclass('public.skill_evidence') is null
     or not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'skills_name_lower_key') then
    raise exception 'Skill catalog migration aborted, nothing changed: apply 20260928000000_skill_progress_evidence.sql first';
  end if;

  if not exists (select 1 from pg_attribute where attrelid = 'public.skills'::regclass
                 and attname = 'category' and atttypid = 'text'::regtype and not attisdropped) then
    raise exception 'Skill catalog migration aborted, nothing changed: public.skills.category (text) is required';
  end if;

  -- Names that differ only by case or spacing would make lookups ambiguous.
  select string_agg(format('%s (x%s)', k, c), ', ') into dupes
  from (select lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) as k, count(*) as c
        from public.skills group by 1 having count(*) > 1) d;
  if dupes is not null then
    raise exception 'Skill catalog migration aborted, nothing changed: public.skills has names that differ only by case or spacing: %', dupes;
  end if;
end $$;

-- 2. Curated catalog additions (inserted only when the name is not already present) ----
create temporary table skill_catalog_seed (name text, category text) on commit drop;
insert into skill_catalog_seed (name, category) values
  -- Frontend
  ('HTML', 'Frontend'), ('CSS', 'Frontend'), ('Next.js', 'Frontend'),
  -- Backend
  ('GraphQL', 'Backend'), ('Django', 'Backend'),
  -- Database
  ('Database Design', 'Database'), ('MySQL', 'Database'), ('NoSQL', 'Database'),
  -- Data science
  ('Statistics', 'Data Science'), ('NumPy', 'Data Science'), ('Pandas', 'Data Science'),
  ('Data Visualization', 'Data Science'), ('Machine Learning', 'Data Science'),
  ('Scikit-learn', 'Data Science'),
  -- DevOps
  ('CI/CD', 'DevOps'), ('Kubernetes', 'DevOps'), ('Terraform', 'DevOps'),
  -- Core CS
  ('Computer Networking', 'Core CS'), ('Object-Oriented Programming', 'Core CS'),
  ('Object-Oriented Design', 'Core CS'), ('Design Patterns', 'Core CS'),
  -- Architecture
  ('System Design', 'Architecture'), ('Microservices', 'Architecture'),
  -- Testing
  ('Testing', 'Testing'), ('Unit Testing', 'Testing'), ('Test-Driven Development', 'Testing');

insert into public.skills (id, name, category)
select gen_random_uuid(), s.name, s.category
from skill_catalog_seed s
where not exists (
  select 1 from public.skills k
  where lower(btrim(regexp_replace(k.name, '\s+', ' ', 'g'))) = lower(s.name));

-- 3. Aliases ------------------------------------------------------------------------
create table if not exists public.skill_aliases (
  alias_key  text        primary key,
  alias      text        not null,
  skill_id   uuid        not null references public.skills(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint skill_aliases_alias_length check (char_length(alias) between 1 and 80),
  constraint skill_aliases_key_normalized
    check (alias_key = lower(btrim(regexp_replace(alias, '\s+', ' ', 'g'))))
);

create index if not exists skill_aliases_skill_idx on public.skill_aliases (skill_id);

alter table public.skill_aliases enable row level security;

-- Public reference data, like public.skills: read by anyone, written only by migrations.
revoke all on table public.skill_aliases from anon, authenticated, public;
grant select on table public.skill_aliases to anon, authenticated;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'skill_aliases' loop
    execute format('drop policy %I on public.skill_aliases', p.policyname);
  end loop;
end $$;

create policy skill_aliases_read_all on public.skill_aliases
  as permissive for select to anon, authenticated using (true);

-- Every alias is a different way of writing the same skill: seen in SkillBridge (code,
-- stored AI output, the assessment) or the standard alternative spelling, abbreviation or
-- version label of that same technology. None joins two different skills. Level words
-- ("JavaScript Basics", "Advanced SQL") are handled by the resolver, not listed here.
create temporary table skill_alias_seed (alias text, canonical text) on commit drop;
insert into skill_alias_seed (alias, canonical) values
  ('React.js', 'React'), ('ReactJS', 'React'), ('React JS', 'React'),
  ('NodeJS', 'Node.js'), ('Node JS', 'Node.js'), ('Node', 'Node.js'),
  ('JS', 'JavaScript'),
  ('NextJS', 'Next.js'), ('Next JS', 'Next.js'),
  ('HTML5', 'HTML'), ('CSS3', 'CSS'),
  ('REST API', 'REST APIs'), ('RESTful API', 'REST APIs'), ('RESTful APIs', 'REST APIs'), ('REST', 'REST APIs'),
  ('Postgres', 'PostgreSQL'),
  ('Data Structures & Algorithms', 'DSA'), ('Data Structures and Algorithms', 'DSA'),
  ('ML', 'Machine Learning'),
  ('sklearn', 'Scikit-learn'), ('scikit learn', 'Scikit-learn'),
  ('Data Visualisation', 'Data Visualization'),
  ('CI/CD Pipelines', 'CI/CD'), ('CI/CD Pipeline', 'CI/CD'),
  ('Continuous Integration/Continuous Deployment', 'CI/CD'),
  ('Continuous Integration and Continuous Deployment', 'CI/CD'),
  ('K8s', 'Kubernetes'),
  ('Amazon Web Services', 'AWS'),
  ('CPP', 'C++'),
  ('Networking', 'Computer Networking'), ('Computer Networks', 'Computer Networking'),
  ('OOP', 'Object-Oriented Programming'), ('OOPs', 'Object-Oriented Programming'),
  ('Object Oriented Programming', 'Object-Oriented Programming'),
  ('Object Oriented Design', 'Object-Oriented Design'), ('OOD', 'Object-Oriented Design'),
  ('Systems Design', 'System Design'),
  ('Microservice Architecture', 'Microservices'), ('Microservices Architecture', 'Microservices'),
  ('Software Testing', 'Testing'),
  ('TDD', 'Test-Driven Development'), ('Test Driven Development', 'Test-Driven Development');

insert into public.skill_aliases (alias_key, alias, skill_id)
select lower(btrim(regexp_replace(a.alias, '\s+', ' ', 'g'))), a.alias, k.id
from skill_alias_seed a
join public.skills k on lower(k.name) = lower(a.canonical)
-- A canonical name always wins over an alias with the same key.
where not exists (select 1 from public.skills n
                  where lower(btrim(regexp_replace(n.name, '\s+', ' ', 'g'))) = lower(btrim(regexp_replace(a.alias, '\s+', ' ', 'g'))))
on conflict (alias_key) do nothing;

-- 4. Self-check before commit: any mismatch aborts and rolls everything back ----
do $$
declare bad text;
begin
  select string_agg(s.name, ', ') into bad from skill_catalog_seed s
  where not exists (select 1 from public.skills k where lower(k.name) = lower(s.name));
  if bad is not null then
    raise exception 'Skill catalog self-check failed: curated skills missing from the catalog: %', bad;
  end if;

  -- Each seeded alias exists and points at its intended skill (not at another one).
  select string_agg(a.alias || ' -> ' || coalesce(k.name, '?'), ', ') into bad
  from skill_alias_seed a
  left join public.skill_aliases x on x.alias_key = lower(btrim(regexp_replace(a.alias, '\s+', ' ', 'g')))
  left join public.skills k on k.id = x.skill_id
  where k.name is null or lower(k.name) <> lower(a.canonical);
  if bad is not null then
    raise exception 'Skill catalog self-check failed: aliases missing or pointing at the wrong skill: %', bad;
  end if;

  select string_agg(x.alias, ', ') into bad
  from public.skill_aliases x
  join public.skills k on lower(btrim(regexp_replace(k.name, '\s+', ' ', 'g'))) = x.alias_key;
  if bad is not null then
    raise exception 'Skill catalog self-check failed: aliases equal to a canonical skill name: %', bad;
  end if;

  select string_agg(k, ', ') into bad
  from (select lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) as k from public.skills
        group by 1 having count(*) > 1) d;
  if bad is not null then
    raise exception 'Skill catalog self-check failed: duplicate canonical names: %', bad;
  end if;

  -- Compound or vague terms stay unresolved: never a skill, never an alias.
  select string_agg(t, ', ') into bad
  from unnest(array['html & css', 'html and css', 'html/css',
                    'object-oriented design & design patterns', 'testing & test-driven development',
                    'programming fundamentals', 'programming basics', 'core programming']) t
  where exists (select 1 from public.skills where lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) = t)
     or exists (select 1 from public.skill_aliases where alias_key = t);
  if bad is not null then
    raise exception 'Skill catalog self-check failed: terms that must stay unresolved became a skill or alias: %', bad;
  end if;

  -- Related but distinct skills keep separate identities.
  select string_agg(format('%s / %s', p.a, p.b), ', ') into bad
  from (values ('HTML', 'CSS'), ('SQL', 'PostgreSQL'), ('SQL', 'MySQL'), ('PostgreSQL', 'MySQL'),
               ('NoSQL', 'MongoDB'), ('NoSQL', 'SQL'), ('Testing', 'Unit Testing'),
               ('Testing', 'Test-Driven Development'), ('Unit Testing', 'Test-Driven Development'),
               ('Object-Oriented Programming', 'Object-Oriented Design'),
               ('Object-Oriented Design', 'Design Patterns'), ('Java', 'JavaScript')) p(a, b)
  where (select id from public.skills where lower(name) = lower(p.a)) is null
     or (select id from public.skills where lower(name) = lower(p.b)) is null
     or (select id from public.skills where lower(name) = lower(p.a))
        = (select id from public.skills where lower(name) = lower(p.b));
  if bad is not null then
    raise exception 'Skill catalog self-check failed: distinct skills missing or merged: %', bad;
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.skill_aliases'::regclass) then
    raise exception 'Skill catalog self-check failed: RLS is not enabled on skill_aliases';
  end if;

  with expected(policyname, cmd, roles) as (
    values ('skill_aliases_read_all', 'SELECT', 'anon,authenticated')
  ),
  actual as (
    select policyname::text as policyname, cmd::text as cmd,
           (select string_agg(r::text, ',' order by r::text) from unnest(roles) r) as roles
    from pg_policies
    where schemaname = 'public' and tablename = 'skill_aliases' and permissive = 'PERMISSIVE'
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || policyname || ' ' || cmd as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || policyname from (select * from expected except select * from actual) y)
    union all
    (select 'restrictive ' || policyname from pg_policies
     where schemaname = 'public' and tablename = 'skill_aliases' and permissive <> 'PERMISSIVE')
  ) z;
  if bad is not null then
    raise exception 'Skill catalog self-check failed: skill_aliases policy set differs: %', bad;
  end if;

  if has_table_privilege('anon', 'public.skill_aliases', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('authenticated', 'public.skill_aliases', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or not has_table_privilege('anon', 'public.skill_aliases', 'SELECT')
     or not has_table_privilege('authenticated', 'public.skill_aliases', 'SELECT')
     or exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                where c.oid = 'public.skill_aliases'::regclass and a.grantee = 0) then
    raise exception 'Skill catalog self-check failed: skill_aliases must be read-only for anon and authenticated, nothing for PUBLIC';
  end if;

  raise notice 'Skill catalog self-check passed: % skills, % aliases, no collisions, skill_aliases read-only',
    (select count(*) from public.skills), (select count(*) from public.skill_aliases);
end $$;

commit;
