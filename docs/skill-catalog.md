# Canonical skill identity (Phase 1.5)

`public.skills` is the single definition of a skill. Its uuid is the identity that
progress, evidence and (later) assessments reference. Everything else that names a skill is
resolved into it:
- profile claims;
- AI gap analyses;
- roadmap steps;
- the assessment picker.

```
raw name ──► key ──► canonical skill (public.skills) ──► skill id
             lower-case, single-spaced, trimmed, hyphen look-alikes → "-"
```

## The rule: normalisation, not merging

The catalog keeps **independently measurable skills** apart. An alias is only a different
way of writing the **same** skill:
- `React.js` → React;
- `K8s` → Kubernetes;
- `Postgres` → PostgreSQL.

Related skills are never folded into one another, even when they are often mentioned
together:

| Separate identities | Why they are not one skill |
|---|---|
| HTML / CSS | learned, assessed, shown and asked for by jobs independently |
| SQL / PostgreSQL / MySQL | a query language vs two database products |
| NoSQL / MongoDB | a database family vs one database |
| Testing / Unit Testing / Test-Driven Development | a discipline, one kind of test, a development practice |
| Object-Oriented Programming / Object-Oriented Design / Design Patterns | a paradigm, designing class structures, reusable design solutions |
| Java / JavaScript | different languages |

Compound or vague terms that name several skills, or no measurable skill, are **left
unresolved**. Recording evidence against the wrong skill would be worse than recording
nothing. See "Unresolved on purpose" below.

## Catalog

Migration: `supabase/migrations/20260928120000_skill_catalog_aliases.sql`. It only inserts,
so the 16 live skills keep their ids, names and categories. There are 42 skills: the 16
live ones plus 26 curated additions (marked *).

| Category | Skills |
|---|---|
| Programming | Python, Java, JavaScript, TypeScript, C++ |
| Frontend | React, HTML*, CSS*, Next.js* |
| Backend | Node.js, REST APIs, GraphQL*, Django* |
| Database | SQL, PostgreSQL, MongoDB, Database Design*, MySQL*, NoSQL* |
| Data Science* | Statistics, NumPy, Pandas, Data Visualization, Machine Learning, Scikit-learn |
| DevOps | Docker, CI/CD*, Kubernetes*, Terraform* |
| Cloud | AWS |
| Core CS | DSA, Computer Networking*, Object-Oriented Programming*, Object-Oriented Design*, Design Patterns* |
| Architecture* | System Design, Microservices |
| Testing* | Testing, Unit Testing, Test-Driven Development |
| Tools | Git |
| Operating System | Linux |

**Intentionally coarse identities**, kept as single skills for now:
- DSA;
- CI/CD;
- Machine Learning;
- System Design;
- AWS.

They may later need child skills (for example AWS Lambda, Deep Learning, CI vs CD). There
is no skill hierarchy yet. The same applies to parent and child pairs that are separate
skills today, such as Testing and Unit Testing: evidence for one does not count for the
other.

## Aliases (42, each one maps to one skill)

| Canonical skill | Aliases |
|---|---|
| React | React.js, ReactJS, React JS |
| Node.js | NodeJS, Node JS, Node |
| JavaScript | JS |
| Next.js | NextJS, Next JS |
| HTML | HTML5 |
| CSS | CSS3 |
| REST APIs | REST API, RESTful API, RESTful APIs, REST |
| PostgreSQL | Postgres |
| DSA | Data Structures & Algorithms, Data Structures and Algorithms |
| Machine Learning | ML |
| Scikit-learn | sklearn, scikit learn |
| Data Visualization | Data Visualisation |
| CI/CD | CI/CD Pipelines, CI/CD Pipeline, Continuous Integration/Continuous Deployment, Continuous Integration and Continuous Deployment |
| Kubernetes | K8s |
| AWS | Amazon Web Services |
| C++ | CPP |
| Computer Networking | Networking, Computer Networks |
| Object-Oriented Programming | OOP, OOPs, Object Oriented Programming |
| Object-Oriented Design | Object Oriented Design, OOD |
| System Design | Systems Design |
| Microservices | Microservice Architecture, Microservices Architecture |
| Testing | Software Testing |
| Test-Driven Development | TDD, Test Driven Development |

The table enforces one skill per alias, and no alias may equal a canonical name. Aliases
are public, read-only reference data, like `skills`.

## Unresolved on purpose

These terms appear in SkillBridge's code or AI output but name more than one skill, or
none. They resolve to `skill: null, reason: "unknown"` and are never silently renamed:

| Term | Where it appears | Why unresolved |
|---|---|---|
| HTML & CSS (also "HTML and CSS", "HTML/CSS") | career-analysis fallback (frontend), learning documentation map, AI roadmap step | two skills; a one-to-one mapping would record evidence against only one of them |
| Object-Oriented Design & Design Patterns | AI roadmap step | two skills; mapping to OOD would drop Design Patterns |
| Testing & Test-Driven Development | AI roadmap step | two skills; mapping to Testing would drop TDD |
| Programming Fundamentals (also "Programming Basics") | career-analysis fallback (backend/software, default) | too vague to give meaningful evidence, confidence or job readiness |
| Core Programming | learning fallback step for users with no skills | same |

Other unresolved names seen so far:
- vague AI terms: "Frontend fundamentals", "Deployment";
- free text that isn't in the catalog: "C#", "Core Java" ("core" is not a level word).

Mapping a compound term to several skills needs one-to-many resolution, which is
deliberately not built. The evidence API can already record one item for several skills
through `group_id`.

## Resolver

`lib/skills/catalog.ts` is the only resolver, used on the server only. It holds no skill
list of its own and reads `skills` and `skill_aliases`.

Every name is first turned into a key: trimmed, single-spaced, lower-cased, and with hyphen
look-alikes folded to the ASCII hyphen `-`. The folded characters are U+2010 hyphen, U+2011
non-breaking hyphen, U+2012 figure dash, U+2013 en dash, U+2014 em dash and U+2212 minus
sign. AI output wrote "Object‑Oriented Design" with U+2011. No other punctuation is
changed. The same key rule is applied to the input, the catalog names and the alias keys.
The database stores ASCII hyphens only, so no migration or alias was needed. Order:

1. The key equals a canonical name: `"html"` → HTML.
2. The key equals an alias: `"react.js"` → React.
3. One level word is removed, then steps 1 and 2 are tried again. Words removed:
   - prefixes: advanced, intermediate, basic, introduction to, intro to, fundamentals of;
   - suffixes: basics, fundamentals, essentials, advanced, framework.

   Examples: `"SQL Advanced"` → SQL, `"JavaScript Basics"` → JavaScript,
   `"Unit Testing Basics"` → Unit Testing (not Testing), `"Networking Basics"` → Computer
   Networking. A compound stays unresolved even with a level word: `"HTML & CSS Basics"`.

There is no substring, prefix or similarity matching. "Java" never becomes "JavaScript",
and "React Native" is not React. `POST /api/skills/resolve` returns every name in order,
resolved or not.

## Where each part of SkillBridge stands

| Area | Canonical identity |
|---|---|
| Profile claims (`profiles.skills`) | Resolved at read time by `GET /api/skills/progress`. Stored claims are unchanged, and a claim is still only a claim. |
| Assessment picker | All 16 options are catalog names. |
| Career analysis / roadmap (AI) | Unchanged. Map names through `/api/skills/resolve`; compound terms stay unresolved. |
| Career analysis fallback | Unchanged. Known gap: exact string comparison ("DSA" vs "Data Structures & Algorithms"). |
| Jobs (`calculateMatch`) | Unchanged. Known gap: substring matching ("Java" inside "JavaScript"). Short aliases (JS, ML, CSS, HTML, Node, REST) must never be used as free-text keywords. |
| Assessments | A future scored assessment adds `skill_id -> skills(id)`. |

## Applying

Order in the Supabase SQL editor:
1. The Phase 1 migration.
2. The Phase 1.5 migration.
3. `skill_progress_evidence_verification.sql`.
4. `skill_catalog_verification.sql`.
5. `p0_rls_verification.sql`, which needs both migrations.
6. The three P1 verifications.
7. `skill_vocabulary_audit.sql` (read-only), to review what stays unresolved in live data.
