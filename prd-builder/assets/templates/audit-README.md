# {{PROJECT}} — <topic> audit ({{DATE}})

Move this file to `docs/audit/<YYYY-MM>-<topic>/README.md`; put screenshots and logs in `evidence/`.

**Commit audited:** <sha> · **Environment:** <browser/OS/build> · **Auditor:** <who>

## 1. Verdict

<3–6 sentences: can the product do its job today? What are the systemic causes?>

| Measure | Result |
| --- | --- |
| Golden-path steps attempted | |
| Steps that work (with caveats) | |
| Steps that "succeed" but mislead or store wrong data | |
| Steps blocked or failing outright | |
| Pages/routes crawled · crashing | |
| <scanner metric> | |

## 2. Test scenario

<Golden paths GP-1…GP-n and the data used.>

### 2.1 Golden-path results
| Step | Result | Finding |
| --- | --- | --- |

## 3. Findings

### 3.1 P0 — Blockers

#### XX-01 · <title>
- **Symptom:** <what the user sees> ([screenshot](./evidence/01-….jpg))
- **Root cause:** `<file>:<line>` — <why>
- **Impact:** <which golden path, what data>
- **Fix direction:** <short; spec link>
- **Evidence:** probe C01 FAIL

### 3.2 P1 — Major
### 3.3 P2 — Quality and consistency

## 4. Systemic root causes
| Root cause | Findings |
| --- | --- |

## 5. Inventories (optional)
## 6. Recommended order of work
## 7. Reproducing this audit
```bash
<probe and scanner commands>
```
### What was not covered
