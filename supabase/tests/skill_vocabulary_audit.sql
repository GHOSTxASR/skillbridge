-- =============================================================================
-- Read-only audit: every skill name SkillBridge has stored, and whether the catalog
-- resolves it
-- =============================================================================
-- Run in the Supabase SQL Editor as the database owner, after
-- 20260928120000_skill_catalog_aliases.sql. It only SELECTs: no row is written.
--
-- Sources: profiles.skills (the users' claims; a JSON array or a comma-separated string),
-- career_analyses.analysis (every skill list in the stored AI analysis) and
-- learning_roadmaps.roadmap (each step's skill). The output has names and counts only,
-- never who used them.
--
-- resolved_by: "name" (a catalog skill), "alias" (public.skill_aliases), or NULL.
-- A NULL row may still resolve in the app by dropping one level word ("SQL Advanced",
-- "JavaScript Basics"; see lib/skills/catalog.ts); anything else is a catalog gap to
-- review.
-- =============================================================================

with claims as (
  select 'profile' as source, p.id as owner, btrim(x) as raw
  from public.profiles p
  cross join lateral unnest(
    case jsonb_typeof(p.skills)
      when 'array'  then array(select jsonb_array_elements_text(p.skills))
      when 'string' then string_to_array(p.skills #>> '{}', ',')
      else array[]::text[]
    end) x
),
analysis_names as (
  select 'career_analysis' as source, c.user_id as owner, btrim(v) as raw
  from public.career_analyses c
  cross join lateral jsonb_each(c.analysis) e
  cross join lateral jsonb_array_elements(case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end) item
  cross join lateral (select case jsonb_typeof(item)
                               when 'string' then item #>> '{}'
                               when 'object' then coalesce(item ->> 'skill', item ->> 'name')
                             end as v) s
  where e.key in ('strengths', 'requiredSkills', 'missingSkills', 'weakSkills', 'prioritySkills',
                  'currentSkills', 'skillGaps', 'roadmap')
    and v is not null
),
roadmap_names as (
  select 'learning_roadmap' as source, r.user_id as owner, btrim(item ->> 'skill') as raw
  from public.learning_roadmaps r
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.roadmap) = 'array' then r.roadmap else '[]'::jsonb end) item
  where jsonb_typeof(item) = 'object' and item ? 'skill'
),
everything as (
  select * from claims union all select * from analysis_names union all select * from roadmap_names
),
keyed as (
  select source, owner, raw, lower(btrim(regexp_replace(raw, '\s+', ' ', 'g'))) as key
  from everything where raw <> ''
)
select k.key                                             as skill_key,
       min(k.raw)                                        as example_spelling,
       string_agg(distinct k.source, ', ')               as seen_in,
       count(distinct k.owner)                           as users,
       coalesce(max(s.name), max(sa.name))               as canonical_skill,
       case when max(s.name) is not null then 'name'
            when max(sa.name) is not null then 'alias' end as resolved_by
from keyed k
left join public.skills s on lower(btrim(regexp_replace(s.name, '\s+', ' ', 'g'))) = k.key
left join public.skill_aliases a on a.alias_key = k.key
left join public.skills sa on sa.id = a.skill_id
group by k.key
order by (max(s.name) is null and max(sa.name) is null) desc, users desc, k.key;
