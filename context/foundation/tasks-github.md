# Plan: Convert roadmap.md → GitHub issues

## Context

[context/foundation/roadmap.md](roadmap.md) lists 6 roadmap items (F-01, F-02, S-01..S-04) in dependency order with structured fields. Goal: create one GitHub issue per item in `siwulus/snapchef` using `gh` CLI, so the work is trackable in GitHub and ready for `/10x-plan` per-change planning. No issues or milestones currently exist in the repo.

## Proposed issue format

**Title pattern**

```
[<ID>] <Change ID>: <short outcome>
```

Examples:

- `[F-01] domain-schema-and-storage: per-user domain tables + RLS + Storage bucket`
- `[F-02] email-verification-gating: email verification required for account activation`
- `[S-01] photo-upload-and-recognition: upload 1–5 photos and review recognized items`
- `[S-02] recipe-generation-from-list: generate recipe from list + meal context` _(north star)_
- `[S-03] save-session-and-recipe: persist full session under owner`
- `[S-04] saved-recipes-readback: list / open / delete saved recipes`

**Body template** (one per issue, all fields from roadmap preserved verbatim where present)

```markdown
> Source: `context/foundation/roadmap.md` → <ID>
> Ready for `/10x-plan <change-id>`

## Outcome

<copied from roadmap>

## PRD refs

<copied>

## Prerequisites

<copied — link to issues by #N once created>

## Parallel with

<copied>

## Unlocks

<copied if present>

## Risk / Rationale

<copied>

## Status

ready

---

Change ID: `<change-id>`
Stream: <A | B>
```

**Labels** (created if missing)

- `roadmap` — every issue
- `foundation` (F-_) or `slice` (S-_)
- `stream:A` / `stream:B`
- `north-star` — S-02 only
- `status:ready`

**Milestone**: single milestone `MVP v1` covering all 6.

**Ordering / dependency wiring**: create in dependency order (F-01, F-02, S-01, S-02, S-03, S-04) so Prerequisite references can be rewritten to real `#N` links in a second pass (`gh issue edit`).

## Creation strategy (gh CLI)

1. Create milestone `MVP v1` via `gh api repos/:owner/:repo/milestones`.
2. Create the 5 missing labels via `gh label create` (existing labels: bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix).
3. For each of 6 items: `gh issue create --title ... --body-file <tmp> --label ... --milestone "MVP v1"`. Capture issue numbers.
4. Second pass: `gh issue edit <N> --body-file <tmp-with-real-#refs>` to replace prerequisite IDs (F-01, etc.) with GitHub `#N` cross-links.

Bodies will be assembled in-memory from roadmap.md content — no new files committed to the repo.

## Files / tools touched

- Read-only: [context/foundation/roadmap.md](roadmap.md)
- External: GitHub repo `siwulus/snapchef` (labels, milestone, 6 issues)
- No repo source edits.

## Validation before execution

Before running any `gh` commands, I will print to chat:

1. Final title list (6 lines)
2. Full rendered body of one representative issue (S-01) for format approval
3. Label + milestone list to be created
4. Exact `gh` command sequence

User approves → execute. User edits → revise and re-show.

## Verification after execution

- `gh issue list --milestone "MVP v1"` shows 6 issues in order
- Spot-check S-02 has `north-star` label and prerequisite link points to S-01's real issue number
- `gh label list` shows new labels
