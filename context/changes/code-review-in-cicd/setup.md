# Code Review in CI/CD — One-time setup & live verification

Phases 1 and 2 (the testable orchestration module and the `code-review.yml`
workflow) are committed. Phase 3 is **operational setup + live verification**:
it needs repo-admin rights, a billable Anthropic key, and a real PR to observe.
This file is the repeatable runbook; check items off on the live PR.

## 1. Repo secret (admin) — required before the gate can run

The workflow reads `ANTHROPIC_API_KEY` (pay-as-you-go) only in the reviewer step.

```bash
# Provide the value interactively (never paste it into a tracked file / shell history):
gh secret set ANTHROPIC_API_KEY --repo siwulus/snapchef
```

- Use a standalone **API key** (pay-as-you-go), not a personal
  `CLAUDE_CODE_OAUTH_TOKEN` subscription token (decision in `change.md`).
- Without it, the reviewer step exits non-zero → the gate fails **closed**
  (blocking status + "infrastructure error" sticky, no verdict label). An outage
  can never sneak unreviewed code into `main`.

## 2. Labels — done

Created via `gh label create` (the workflow also has a defensive ensure-step, so
this is belt-and-suspenders):

| Label           | Color     | Meaning                                      |
| --------------- | --------- | -------------------------------------------- |
| `cr:pass`       | `#0e8a16` | Gate passed (mirror of the status)           |
| `cr:fail`       | `#d93f0b` | Gate failed (mirror of the status)           |
| `cr:revalidate` | `#fbca04` | Add to re-run the review on the current HEAD |

Labels **mirror** the gate; they are never the gate themselves (anyone can edit a
label). The required commit status is the real gate (next step).

## 3. Required status check (admin) — makes the gate actually block

The gate is the commit status `code-review/gate`, posted on the PR **head SHA**.
Mark it **required** on `main` so a `failure`/missing status blocks merge.

**Ruleset (preferred — lets you type the context name before it has ever run):**

1. Repo → Settings → Rules → Rulesets → New branch ruleset.
2. Target branch: `main`. Enable **Require status checks to pass**.
3. Add required check: type `code-review/gate` (source: any / the workflow).
4. (Recommended) also enable "Require branches to be up to date before merging" —
   combined with the per-SHA staleness this is the cost-control behavior: a new
   commit leaves the gate stale → blocked until `cr:revalidate` re-runs it.

**Classic branch protection (fallback):** if `code-review/gate` is not yet
selectable, let the workflow run once on a test PR to register the context, then
select it in Settings → Branches → branch protection for `main`.

> Rollback: delete the ruleset/required-check rule (instant), and/or delete
> `.github/workflows/code-review.yml`. The required-check rule is the only change
> that affects merges.

## 4. Live end-to-end walkthrough (on a throwaway test PR)

Open a PR to `main` with a deliberately flawed diff and confirm, in order:

- **(a)** Review runs automatically on open.
- **(b)** Inline comments land on diff lines; line-less / out-of-diff findings
  appear in the single sticky summary comment.
- **(c)** `cr:fail` + `code-review/gate = failure` → merge blocked.
- **(d)** Push a fix commit → the gate goes stale ("Expected — waiting") on the
  new head SHA → merge still blocked (no AI ran — cost control).
- **(e)** Add `cr:revalidate` → it is consumed (removed), the review re-runs on
  the new head SHA, prior bot inline comments are replaced (no duplicates),
  labels swap to `cr:pass`, status flips to `success` → merge allowed.
- **(f)** Add an unrelated label → **no** review runs and the status is **not**
  clobbered.

Also verify the **context-line decision**: if any inline post returns HTTP 422
("line must be part of the diff"), tighten `.github/scripts/code-review/src/diff.ts`
`parseValidLines` to record **added lines only** (drop the context-line branch),
re-run `pnpm --filter @snapchef/code-review-ci test`, and re-push.

**Infra-failure check:** temporarily set a bad `ANTHROPIC_API_KEY`, add
`cr:revalidate`, and confirm a blocking `failure` status + error sticky + **no**
verdict label. Restore the key afterward.

## Mapping to plan Progress (Phase 3)

| Row                                                      | Status                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 3.1 gate check transitions failure→stale→success         | live PR (after secret + required check)                                                                                |
| 3.2 secret + 3 labels exist                              | labels ✅ created; **secret pending (admin)**                                                                          |
| 3.3 `code-review/gate` required on `main`                | **pending (admin)**                                                                                                    |
| 3.4 walkthrough (a)–(f)                                  | live PR                                                                                                                |
| 3.5 merge blocked on failure/missing, allowed on success | live PR                                                                                                                |
| 3.6 infra-failure path fail-closed                       | ✅ verified live — PR #19 run 28330027406 (no secret ⇒ blocking `failure` + error sticky + no verdict label, no spend) |
| 3.7 no duplicate inline comments after revalidate        | live PR                                                                                                                |
