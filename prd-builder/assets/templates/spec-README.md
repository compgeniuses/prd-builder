# {{PROJECT}} — Specification

**Version:** 0.1 · **Date:** {{DATE}} · **Status:** Draft · **Owner:** <owner>

Move this file to `docs/specs/<product>/README.md` and add numbered domain documents beside it.

## Documents

| File | Covers |
| --- | --- |
| `01-<first-phase-topic>.md` | <e.g. stabilisation workstreams WS1.1…> |
| `02-domain-model.md` | Entities, relationships, identifiers, lifecycle states |
| `03-<core-capability>.md` | <core rules and calculations> |
| `06-platform-architecture.md` | Storage, sync, auth, security, privacy, i18n, extensibility |
| `07-ux-standards.md` | Components, forms, errors, accessibility, empty states |
| `08-quality-and-release.md` | Test strategy, golden paths, migrations, release channels |

## 1. Vision
<Who, what job, why now — one paragraph.>

## 2. Principles
1. <principle> — <why it matters; how it resolves design arguments>

## 3. Scope
### In scope
### Out of scope (kept, but not specified here)

## 4. Personas & primary jobs
| Persona | Primary jobs | Frequency | Device / context |
| --- | --- | --- | --- |

## 5. Glossary (canonical terms)
| Term | Meaning | Avoid |
| --- | --- | --- |

## 6. Phased roadmap
## 7. Success metrics
## 8. Non-goals and constraints

---

### Domain document skeleton (`0n-<domain>.md`)

```markdown
# 0n — <Domain>
## 1. Purpose and boundaries
## 2. Concepts and data model
## 3. Workflows
## 4. Rules and calculations (with worked examples)
## 5. Permissions
## 6. Errors and edge cases
## 7. Configuration and variants
## 8. Acceptance examples (input → expected output; these become test vectors)
## 9. Open questions (each becomes a DR in the PRD)
```
