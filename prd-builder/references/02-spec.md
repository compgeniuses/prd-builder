# 02 — Specification

The spec describes the **target product** in enough detail that a task card can link to a
section instead of re-explaining it. The PRD says *what* and *when*; the spec says *how it must
behave*. Keep them separate: the PRD stays short and stable, the spec can grow.

## Contents
1. File layout
2. README (index) structure
3. Domain document structure
4. Writing rules
5. Research and sources
6. Done-when checklist

---

## 1. File layout

```
docs/specs/<product>/
  README.md                    index, vision, principles, scope, personas, glossary, roadmap, metrics
  01-<first-phase-topic>.md    e.g. stabilisation workstreams (WS1.1 …) derived from the audit
  02-domain-model.md           entities, relationships, identifiers, lifecycle states
  03-<core-capability>.md      e.g. curriculum & assessment / catalogue & pricing
  04-<user-lifecycle>.md       e.g. student lifecycle / customer lifecycle
  05-<money>.md                billing, payments, accounting (if any)
  06-platform-architecture.md  storage, sync, auth, security, privacy, i18n, extensibility
  07-ux-standards.md           components, forms, errors, accessibility, empty states
  08-quality-and-release.md    test strategy, golden paths, migrations, release channels
```

Number documents so section references are short (`05 §4`). Adapt the topics to the product;
keep platform, UX and quality as separate documents in almost every project.

## 2. README (index) structure

```markdown
# <Product> — <spec name>
**Version** · **Date** · **Status** (draft/approved) · **Owner**

## Documents        (table: file | covers)
## 1. Vision        (one paragraph: who, what job, why now)
## 2. Principles    (5–10 numbered, each one sentence + why; these resolve design arguments)
## 3. Scope         (In scope / Out of scope — kept but not specified here)
## 4. Personas & primary jobs   (table: persona | primary jobs | frequency | device/context)
## 5. Glossary      (canonical terms; one meaning per word; note synonyms to avoid)
## 6. Phased roadmap   (high level; the PRD refines it)
## 7. Success metrics
## 8. Non-goals and constraints
```

## 3. Domain document structure

```markdown
# 0n — <Domain>
## 1. Purpose and boundaries
## 2. Concepts and data model     (entities, fields that matter, invariants, lifecycle states)
## 3. Workflows                   (numbered steps per workflow; actors; pre/post-conditions)
## 4. Rules and calculations      (formulas, rounding, ordering, edge cases — with worked examples)
## 5. Permissions                 (who can do what, maker-checker, audit)
## 6. Errors and edge cases       (what the user sees; what is logged)
## 7. Configuration and variants  (per country/plan/tenant; how packs/plugins extend it)
## 8. Acceptance examples         (input → expected output tables; these become test vectors)
## 9. Open questions              (each becomes a DR in the PRD)
```

Workstreams in the first-phase document get ids (`WS1.1`, `WS1.2`) so tasks can cite them.

## 4. Writing rules

- **Testable statements.** "Balances reconcile to the cent" beats "finance should be accurate".
- **Worked examples** for every calculation; they become unit-test vectors verbatim.
- **No hidden assumptions.** If the product will serve several markets, the core spec never names one market's terms; variants live in configuration/pack sections.
- **Link, do not copy.** The PRD and task cards cite `<doc> §<n>`; never paste spec text into tasks.
- **Stable anchors.** Do not renumber published sections; append.
- **Mark uncertainty.** Facts you could not verify (regulations, standards, third-party APIs) carry a source and a `verification: unverified` note.
- **Name the standard, not the adjective.** A quality bar is only real once it has a number and a check. `07-ux-standards.md` states the accessibility target and how it is proven — for example "WCAG 2.2 AA; axe clean on the golden path; every control reachable and operable by keyboard only" — never "accessible", "user-friendly" or "modern". Performance, offline, i18n and browser-support targets are written the same way: value, measurement, where it runs.

## 5. Research and sources

For domain facts (regulations, curricula, tax rules, protocols) collect sources first, then
write. Record each source with title, URL, date accessed. Use sub-agents for parallel research
if available (cheap model for collection, stronger model for synthesis — see 09). Unverified
facts are allowed in the spec but must be marked; the PRD risk table should mention them.

**Compare before choosing.** Where the spec fixes a technology, framework, hosting or vendor
decision, weigh at least two real options, write down the trade-offs that decided it (cost,
lock-in, operational burden, team familiarity, exit path) and the one chosen, and record it as
a decision record in the PRD (`03 §9`). A single-option recommendation is an opinion nobody can
revisit later; two named alternatives with the reason is a decision.

## 6. Done-when checklist

- [ ] Every capability the PRD will require has a section to link to.
- [ ] Glossary covers every domain noun used in requirements.
- [ ] Every calculation has at least one worked example.
- [ ] Open questions are listed (they become DRs).
- [ ] Committed: `docs(spec): <product> specification v<version>`.
